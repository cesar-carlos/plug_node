import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  defaultBenchmarkBaselinePath,
  readBenchmarkBaseline,
  runPayloadFrameBenchmark,
} from "./benchmark-payload-frame.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const regressionThreshold = Number.parseFloat(
  process.env.PLUG_BENCH_MAX_REGRESSION ?? "0.15",
);

const baselinePath = process.env.PLUG_BENCH_BASELINE ?? defaultBenchmarkBaselinePath;
const baseline = await readBenchmarkBaseline(baselinePath);
const current = runPayloadFrameBenchmark();

const encodeWithTraceId = current.find(
  (entry) => entry.name === "encode PayloadFrame with traceId",
);
const encodeOmitTraceId = current.find(
  (entry) => entry.name === "encode PayloadFrame omitTraceId",
);

const baselineByName = new Map(baseline.map((entry) => [entry.name, entry]));
const regressions = [];

if (
  encodeWithTraceId &&
  encodeOmitTraceId &&
  encodeOmitTraceId.avgMs >= encodeWithTraceId.avgMs
) {
  regressions.push(
    `encode omitTraceId (${encodeOmitTraceId.avgMs}ms avg) must be faster than with traceId (${encodeWithTraceId.avgMs}ms avg)`,
  );
}

for (const result of current) {
  const baselineEntry = baselineByName.get(result.name);
  if (!baselineEntry) {
    regressions.push(`${result.name}: missing from baseline ${baselinePath}`);
    continue;
  }

  const allowedAvgMs = baselineEntry.avgMs * (1 + regressionThreshold);
  if (result.avgMs > allowedAvgMs) {
    regressions.push(
      `${result.name}: avgMs ${result.avgMs} exceeded baseline ${baselineEntry.avgMs} by more than ${Math.round(regressionThreshold * 100)}% (allowed ${allowedAvgMs.toFixed(4)})`,
    );
  }
}

if (regressions.length > 0) {
  console.error("PayloadFrame benchmark regression detected:");
  for (const message of regressions) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log(
  `PayloadFrame benchmark within ${Math.round(regressionThreshold * 100)}% of baseline (${path.relative(scriptDirectory, baselinePath)}).`,
);
