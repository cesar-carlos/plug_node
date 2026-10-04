import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = process.cwd();
const baseline = path.resolve(
  process.env.PLUG_BENCH_TYPESCRIPT_BASE ??
    "tmp/dependency-migration-baseline/reconstructed",
);
const reportPath = path.resolve(
  process.env.PLUG_BENCH_REPORT_PATH ??
    "tmp/e2e-logs/dependency-migration/runtime-comparison.json",
);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (process.argv[2] === "--worker") {
  const directory = process.argv[3];
  const { runPayloadFrameBenchmark } = await import(
    pathToFileURL(path.join(directory, "scripts/benchmark-payload-frame.mjs"))
  );
  const payload = await runPayloadFrameBenchmark();
  console.log(JSON.stringify(payload));
} else {
  const runs = [];
  for (let repetition = 0; repetition < 9; repetition++) {
    const pair = {};
    for (const name of repetition % 2
      ? ["candidate", "baseline"]
      : ["baseline", "candidate"]) {
      const directory = name === "baseline" ? baseline : root;
      pair[name] = {};
      for (const suite of ["payload", "gzip"]) {
        const args =
          suite === "payload"
            ? [fileURLToPath(import.meta.url), "--worker", directory]
            : [path.join(directory, "scripts/benchmark-gzip-levels.mjs"), "--worker"];
        const child = spawnSync(process.execPath, ["--expose-gc", ...args], {
          cwd: directory,
          encoding: "utf8",
          timeout: 120_000,
        });
        if (child.status !== 0) throw new Error(child.stderr || child.stdout);
        pair[name][suite] = JSON.parse(child.stdout.trim().split("\n").at(-1));
      }
    }
    runs.push(pair);
    console.log(`Completed isolated codec comparison ${repetition + 1}/9`);
  }
  const summarize = (name, suite, index, metric) =>
    median(runs.map((pair) => pair[name][suite][index][metric]));
  const payload = runs[0].baseline.payload.map((entry, index) => {
    const base = summarize("baseline", "payload", index, "avgMs");
    const candidate = summarize("candidate", "payload", index, "avgMs");
    return {
      scenario: entry.name,
      baselineAvgMs: base,
      candidateAvgMs: candidate,
      averageRatio: candidate / base,
    };
  });
  const gzip = runs[0].baseline.gzip.flatMap((entry, index) => {
    if (entry.level !== 3) return [];
    const metrics = ["p95Ms", "throughput", "heapGrowthBytes", "compressedSize"];
    const summarizeAll = (name) =>
      Object.fromEntries(
        metrics.map((metric) => [metric, summarize(name, "gzip", index, metric)]),
      );
    const base = summarizeAll("baseline"),
      candidate = summarizeAll("candidate");
    const ratios = {
      p95: candidate.p95Ms / base.p95Ms,
      throughput: candidate.throughput / base.throughput,
      heapGrowth: candidate.heapGrowthBytes / base.heapGrowthBytes,
      compressedBytes: candidate.compressedSize / base.compressedSize,
    };
    return [
      {
        scenario: entry.scenario,
        baseline: base,
        candidate,
        ratios,
        passed:
          ratios.p95 <= 1.05 &&
          ratios.throughput >= 0.85 &&
          ratios.heapGrowth <= 1.1 &&
          ratios.compressedBytes <= 1.1,
      },
    ];
  });
  const gzipLevelSelection = runs[0].candidate.gzip.flatMap((entry, index) => {
    if (entry.level !== 3) return [];
    const baseIndex = runs[0].candidate.gzip.findIndex(
      (value) => value.scenario === entry.scenario && value.level === 6,
    );
    const ratio = (metric) =>
      summarize("candidate", "gzip", index, metric) /
      summarize("candidate", "gzip", baseIndex, metric);
    const ratios = {
      p95: ratio("p95Ms"),
      throughput: ratio("throughput"),
      heapGrowth: ratio("heapGrowthBytes"),
      compressedBytes: ratio("compressedSize"),
    };
    return [
      {
        scenario: entry.scenario,
        ratios,
        passed:
          ratios.p95 <= 1.05 &&
          ratios.throughput >= 0.85 &&
          ratios.heapGrowth <= 1.1 &&
          ratios.compressedBytes <= 1.1,
      },
    ];
  });
  const report = {
    createdAt: new Date().toISOString(),
    node: process.version,
    repetitions: 9,
    baseline,
    methodology:
      "Alternating isolated processes executing the existing PayloadFrame suite and gzip worker. PayloadFrame average timings are descriptive; its existing baseline gate is run separately. Production gzip level 3 uses p95, throughput and peak-heap gates; level selection retains the existing level 6 comparison.",
    payload,
    gzip,
    gzipLevelSelection,
    runs,
    passed:
      gzip.every((entry) => entry.passed) &&
      gzipLevelSelection.every((entry) => entry.passed),
  };
  mkdirSync(path.dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.table(
    gzip.map((entry) => ({
      scenario: entry.scenario,
      ...entry.ratios,
      passed: entry.passed,
    })),
  );
  console.log(`Report: ${reportPath}`);
  if (!report.passed) process.exitCode = 1;
}
