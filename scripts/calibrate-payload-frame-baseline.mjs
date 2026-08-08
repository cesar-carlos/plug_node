import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultBenchmarkBaselinePath,
  runPayloadFrameBenchmark,
} from "./benchmark-payload-frame.mjs";

/**
 * Calibrate PayloadFrame baseline for the current runner (prefer ubuntu-latest CI).
 * Pads avgMs so the regression gate has headroom for timer noise.
 */
const padAvgMs = (avgMs) => {
  const factor = avgMs < 0.003 ? 1.25 : 1.1;
  return Number((avgMs * factor).toFixed(4));
};

const results = await runPayloadFrameBenchmark();
const baseline = results.map((entry) => {
  const avgMs = padAvgMs(entry.avgMs);
  const totalMs = Number((avgMs * entry.iterations).toFixed(2));
  return {
    ...entry,
    avgMs,
    totalMs,
    opsPerSecond: Number(((entry.iterations / totalMs) * 1000).toFixed(1)),
  };
});

const outputPath =
  process.env.PLUG_BENCH_OUTPUT ?? process.argv[2] ?? defaultBenchmarkBaselinePath;

await writeFile(outputPath, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
console.log(
  `Wrote padded PayloadFrame baseline (${baseline.length} cases) to ${path.relative(
    path.dirname(fileURLToPath(import.meta.url)),
    outputPath,
  )}`,
);
console.table(baseline);
