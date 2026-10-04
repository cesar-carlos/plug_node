import { spawnSync } from "node:child_process";
import { createHash, createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(
  process.env.PLUG_BENCH_REPORT_PATH ??
    path.join(root, "tmp/e2e-logs/gzip-level-comparison.json"),
);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (process.argv[2] === "--worker") {
  const imported =
    await import("../packages/n8n-nodes-plug-database/dist/generated/shared/socket/payloadFrameCodec.js");
  const codec = imported.default ?? imported;
  const text = Array.from({ length: 2500 }, (_, i) =>
    createHash("sha256").update(String(i)).digest("hex"),
  ).join("");
  const rows = Array.from({ length: 800 }, (_, i) => ({
    id: i,
    name: `Cliente ${i}`,
    data: createHash("sha256").update(String(i)).digest("hex"),
  }));
  const limitText = text
    .repeat(Math.ceil((10 * 1024 * 1024) / text.length))
    .slice(0, 10 * 1024 * 1024 - 64);
  const scenarios = [
    {
      name: "repetitive-sql",
      data: {
        sql: "SELECT CodCliente, Nome FROM Cliente ORDER BY CodCliente; ".repeat(2000),
      },
      count: 25,
    },
    { name: "sql-rows", data: { rows }, count: 25 },
    { name: "low-compressibility", data: { text }, count: 15 },
    { name: "signed-sql-rows", data: { rows }, signed: true, count: 25 },
    { name: "near-10MiB", data: { text: limitText }, signed: true, count: 2 },
  ];
  const results = [];
  for (const scenario of scenarios) {
    const bytes = Buffer.from(JSON.stringify(scenario.data));
    for (const level of [6, 1, 3]) {
      const samples = [];
      let compressedSize;
      let cmp;
      const started = performance.now();
      global.gc();
      const before = process.memoryUsage().heapUsed;
      let peak = before;
      for (let iteration = 0; iteration < scenario.count; iteration++) {
        const start = performance.now();
        const gzip = gzipSync(bytes, { level });
        // Preserve the production inflation fallback for all compared levels.
        const useGzip =
          bytes.length / gzip.length <= 10 && bytes.length - gzip.length >= 64;
        const payload = useGzip ? gzip : bytes;
        const frame = {
          schemaVersion: "1.0",
          enc: "json",
          cmp: useGzip ? "gzip" : "none",
          contentType: "application/json",
          originalSize: bytes.length,
          compressedSize: payload.length,
          requestId: "fixture",
          payload,
        };
        let signing;
        if (scenario.signed) {
          signing = { key: "benchmark-fixture-key", requireSignature: true };
          const metadata = JSON.stringify({
            schemaVersion: frame.schemaVersion,
            enc: frame.enc,
            cmp: frame.cmp,
            contentType: frame.contentType,
            originalSize: frame.originalSize,
            compressedSize: frame.compressedSize,
            traceId: null,
            requestId: frame.requestId,
          });
          frame.signature = {
            alg: "hmac-sha256",
            value: createHmac("sha256", signing.key)
              .update(Buffer.concat([Buffer.from(metadata), Buffer.from([0]), payload]))
              .digest("base64"),
          };
        }
        const decoded = codec.decodePayloadFrame(frame, { signing });
        if (!decoded.bytes.equals(bytes)) throw new Error("Gzip round-trip mismatch");
        samples.push(performance.now() - start);
        peak = Math.max(peak, process.memoryUsage().heapUsed);
        compressedSize = payload.length;
        cmp = frame.cmp;
      }
      const duration = performance.now() - started;
      results.push({
        scenario: scenario.name,
        level,
        originalSize: bytes.length,
        compressedSize,
        cmp,
        p95Ms: samples.sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1],
        throughput: (scenario.count / duration) * 1000,
        heapGrowthBytes: Math.max(1, peak - before),
      });
    }
  }
  // Size guard is independent of compression level; no oversized frame may pass.
  const oversized = {
    schemaVersion: "1.0",
    enc: "json",
    cmp: "gzip",
    contentType: "application/json",
    originalSize: 10 * 1024 * 1024 + 1,
    compressedSize: 1,
    payload: Buffer.from([0]),
  };
  let rejected = false;
  try {
    codec.decodePayloadFrame(oversized);
  } catch {
    rejected = true;
  }
  if (!rejected) throw new Error("Oversized frame accepted");
  console.log(JSON.stringify(results));
} else {
  await mkdir(path.dirname(output), { recursive: true });
  const runs = [];
  for (let repetition = 0; repetition < 9; repetition++) {
    const worker = spawnSync(
      process.execPath,
      ["--expose-gc", fileURLToPath(import.meta.url), "--worker"],
      { cwd: root, encoding: "utf8", timeout: 120_000 },
    );
    if (worker.status !== 0) throw new Error(worker.stderr.slice(-2000));
    runs.push(JSON.parse(worker.stdout.trim().split("\n").at(-1)));
    console.log(`Completed gzip comparison ${repetition + 1}/9`);
  }
  const results = runs[0].map((entry, index) => ({
    ...entry,
    ...Object.fromEntries(
      ["p95Ms", "throughput", "heapGrowthBytes"].map((metric) => [
        metric,
        median(runs.map((run) => run[index][metric])),
      ]),
    ),
  }));
  const comparisons = results
    .filter((entry) => entry.level === 3)
    .map((next) => {
      const base = results.find(
        (entry) => entry.scenario === next.scenario && entry.level === 6,
      );
      const ratios = {
        p95: next.p95Ms / base.p95Ms,
        throughput: next.throughput / base.throughput,
        heapGrowth: next.heapGrowthBytes / base.heapGrowthBytes,
        compressedBytes: next.compressedSize / base.compressedSize,
      };
      return {
        scenario: next.scenario,
        ratios,
        passed:
          ratios.p95 <= 1.05 &&
          ratios.throughput >= 0.85 &&
          ratios.heapGrowth <= 1.1 &&
          ratios.compressedBytes <= 1.1,
      };
    });
  const report = {
    createdAt: new Date().toISOString(),
    node: process.version,
    repetitions: 9,
    methodology:
      "Nine isolated processes; identical payload bytes; sync gzip levels 6, 1 and 3 plus HMAC and production decode; medians; inflation fallback preserved. Near-limit input uses forced compression, since default mode bypasses gzip above 512 KiB.",
    results,
    comparisons,
    selectedLevel: comparisons.every((entry) => entry.passed) ? 3 : 6,
    runs,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.table(
    comparisons.map((entry) => ({
      scenario: entry.scenario,
      p95Ratio: entry.ratios.p95.toFixed(3),
      bytesRatio: entry.ratios.compressedBytes.toFixed(3),
      passed: entry.passed,
    })),
  );
  console.log(`Selected gzip level: ${report.selectedLevel}. Report: ${output}`);
}
