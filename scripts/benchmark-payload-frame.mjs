import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
export const defaultBenchmarkBaselinePath = path.join(
  scriptDirectory,
  "benchmarks",
  "payload-frame-baseline.json",
);

const iterations = Number.parseInt(process.env.PLUG_BENCH_ITERATIONS ?? "1000", 10);
const effectiveIterations =
  Number.isFinite(iterations) && iterations > 0 ? iterations : 1000;

const codec =
  await import("../packages/n8n-nodes-plug-database/dist/generated/shared/socket/payloadFrameCodec.js");

const { decodePayloadFrame, encodePayloadFrame } = codec.default ?? codec;

const buildRows = (count) =>
  Array.from({ length: count }, (_, index) => ({
    id: index,
    value: `plug-row-${index.toString(36).padStart(6, "0")}`,
  }));

const frames = {
  smallNone: encodePayloadFrame(
    { ok: true, rows: [{ id: 1, value: "small" }] },
    { requestId: "bench-small", compression: "none" },
  ),
  largeGzip: encodePayloadFrame(
    { rows: buildRows(4_000) },
    { requestId: "bench-large", compression: "default" },
  ),
  forcedGzip: encodePayloadFrame(
    { rows: buildRows(8_000) },
    { requestId: "bench-forced", compression: "always" },
  ),
};

const rejectedInflationFrame = {
  ...frames.largeGzip,
  originalSize: frames.largeGzip.compressedSize * 21,
};

const measure = (name, fn, count = effectiveIterations) => {
  const startedAt = performance.now();
  for (let index = 0; index < count; index += 1) {
    fn();
  }
  const durationMs = performance.now() - startedAt;
  return {
    name,
    iterations: count,
    totalMs: Number(durationMs.toFixed(2)),
    avgMs: Number((durationMs / count).toFixed(4)),
    opsPerSecond: Number(((count / durationMs) * 1000).toFixed(1)),
  };
};

export const runPayloadFrameBenchmark = () => {
  const commandPayload = { method: "sql.execute", params: { sql: "SELECT TOP 1 1" } };
  const withTraceId = encodePayloadFrame(commandPayload, {
    requestId: "bench-trace",
    compression: "none",
  });
  const omitTraceId = encodePayloadFrame(commandPayload, {
    requestId: "bench-omit-trace",
    compression: "none",
    omitTraceId: true,
  });

  return [
    measure("encode PayloadFrame with traceId", () => {
      encodePayloadFrame(commandPayload, {
        requestId: "bench-trace",
        compression: "none",
      });
    }),
    measure("encode PayloadFrame omitTraceId", () => {
      encodePayloadFrame(commandPayload, {
        requestId: "bench-omit-trace",
        compression: "none",
        omitTraceId: true,
      });
    }),
    measure("decode small PayloadFrame without gzip", () => {
      decodePayloadFrame(frames.smallNone);
    }),
    measure("decode encode-with-traceId frame", () => {
      decodePayloadFrame(withTraceId);
    }),
    measure("decode encode-omitTraceId frame", () => {
      decodePayloadFrame(omitTraceId);
    }),
    measure("decode large PayloadFrame with gzip", () => {
      decodePayloadFrame(frames.largeGzip);
    }),
    measure(
      "decode forced gzip PayloadFrame",
      () => {
        decodePayloadFrame(frames.forcedGzip);
      },
      Math.max(10, Math.floor(effectiveIterations / 4)),
    ),
    measure("reject unsafe gzip inflation metadata", () => {
      try {
        decodePayloadFrame(rejectedInflationFrame);
      } catch {
        return;
      }
      throw new Error("Expected unsafe PayloadFrame to be rejected");
    }),
  ];
};

export const readBenchmarkBaseline = async (
  baselinePath = defaultBenchmarkBaselinePath,
) => JSON.parse(await readFile(baselinePath, "utf8"));

const isMainModule =
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMainModule) {
  const results = runPayloadFrameBenchmark();
  console.table(results);

  const outputPath = process.env.PLUG_BENCH_OUTPUT ?? process.argv[2];
  if (outputPath) {
    await writeFile(outputPath, `${JSON.stringify(results, null, 2)}\n`, "utf8");
    console.log(`Wrote benchmark results to ${outputPath}`);
  }
}
