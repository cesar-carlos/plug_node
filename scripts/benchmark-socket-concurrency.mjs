import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = path.resolve(
  process.env.PLUG_BENCH_TRANSPORT_BASE ?? path.join(root, "tmp/transport-baseline/dist"),
);
const candidate = path.join(root, "packages/n8n-nodes-plug-database/dist");
const output = path.resolve(
  process.env.PLUG_BENCH_REPORT_PATH ??
    path.join(root, "tmp/e2e-logs/socket-concurrency-comparison.json"),
);
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const load = async (directory, module) => {
  const imported = await import(
    pathToFileURL(path.join(directory, "generated/shared/socket", module + ".js"))
  );
  return imported.default ?? imported;
};

if (process.argv[2] === "--worker" || process.argv[2] === "--server") {
  const serverMode = process.argv[2] === "--server";
  const unhandledFailures = [];
  // Record legacy failures as correctness failures. They must not turn a
  // candidate failure into a successful performance result.
  process.on("unhandledRejection", (error) => unhandledFailures.push(String(error)));
  process.on("rejectionHandled", () => undefined);
  const directory = process.argv[3];
  const { executeConsumerCommand } = serverMode
    ? {}
    : await load(directory, "consumerCommandSession");
  // Keep server encoding in another process: otherwise only the candidate
  // imports a second codec graph, changing its heap and GC schedule.
  const { encodePayloadFrame } = serverMode
    ? await load(directory, "payloadFrameCodec")
    : {};
  let serverFixtures;
  if (!serverMode) {
    const server = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--server", baseline],
      { cwd: root, encoding: "utf8", timeout: 120_000, maxBuffer: 32 * 1024 * 1024 },
    );
    if (server.status !== 0) throw new Error(server.error?.message || server.stderr);
    serverFixtures = JSON.parse(server.stdout.trim(), (_key, value) =>
      value?.type === "Buffer" && Array.isArray(value.data)
        ? Buffer.from(value.data)
        : value,
    );
  }
  const signing = { key: "benchmark-fixture-key", requireSignature: true };
  const rows = Array.from({ length: 320 }, (_, i) => ({
    index: i,
    value: createHash("sha256").update(`row-${i}`).digest("hex"),
  }));
  const results = [];
  for (const concurrency of [1, 4, 8])
    for (const streaming of [false, true]) {
      const failuresBefore = unhandledFailures.length;
      const fixtures = serverMode
        ? Array.from({ length: concurrency }, (_, i) => {
            const request = `bench-${i}`;
            const hub = `hub-${i}`;
            const stream = `stream-${i}`;
            const frame = (data, compression = "default") =>
              encodePayloadFrame(data, {
                requestId: hub,
                compression,
                signing,
                omitTraceId: true,
              });
            return {
              request,
              hub,
              stream,
              response: frame({
                success: true,
                clientRequestId: request,
                requestId: hub,
                ...(streaming ? { streamId: stream } : {}),
                response: {
                  type: "single",
                  success: true,
                  item: {
                    id: request,
                    success: true,
                    result: {
                      rows: streaming ? [] : rows,
                      ...(streaming ? { stream_id: stream } : {}),
                    },
                  },
                },
              }),
              chunks: Array.from({ length: 8 }, () =>
                frame({ request_id: hub, stream_id: stream, rows }),
              ),
              complete: frame(
                { request_id: hub, stream_id: stream, terminal_status: "completed" },
                "none",
              ),
              ack: frame(
                { success: true, requestId: hub, streamId: stream, windowSize: 256 },
                "none",
              ),
            };
          })
        : serverFixtures.find(
            (entry) => entry.concurrency === concurrency && entry.streaming === streaming,
          ).fixtures;
      if (serverMode) {
        results.push({ concurrency, streaming, fixtures });
        continue;
      }
      class Transport {
        connected = true;
        handlers = new Map();
        connect() {}
        disconnect() {}
        on(event, handler) {
          const set = this.handlers.get(event) ?? new Set();
          set.add(handler);
          this.handlers.set(event, set);
        }
        off(event, handler) {
          this.handlers.get(event)?.delete(handler);
        }
        dispatch(event, payload) {
          for (const handler of [...(this.handlers.get(event) ?? [])]) handler(payload);
        }
        emit(event, payload) {
          if (event === "agents:command") {
            const fixture = fixtures.find((item) => item.request === payload.requestId);
            setTimeout(
              () => this.dispatch("agents:command_response", fixture.response),
              5,
            );
          } else if (event === "agents:stream_pull") {
            const fixture = fixtures.find((item) => item.hub === payload.requestId);
            queueMicrotask(() => {
              this.dispatch("agents:stream_pull_response", fixture.ack);
              for (const chunk of fixture.chunks)
                this.dispatch("agents:command_stream_chunk", chunk);
              this.dispatch("agents:command_stream_complete", fixture.complete);
            });
          }
        }
      }
      const transport = new Transport();
      const run = () =>
        Promise.all(
          fixtures.map((fixture, i) =>
            executeConsumerCommand({
              transport,
              agentId: `agent-${i}`,
              session: {
                accessToken: "fixture",
                credentials: { baseUrl: "https://fixture.invalid/api/v1" },
              },
              command: {
                jsonrpc: "2.0",
                method: "sql.execute",
                id: fixture.request,
                params: { sql: "SELECT 1" },
              },
              payloadFrameSigning: signing,
              responseMode: "aggregatedJson",
            }),
          ),
        );
      for (let i = 0; i < 8; i++) await run();
      global.gc();
      const before = process.memoryUsage().heapUsed;
      let peak = before;
      const samples = [];
      let decodes;
      const start = performance.now();
      for (let i = 0; i < 48; i++) {
        const round = performance.now();
        const responses = await run();
        await new Promise((resolve) => setImmediate(resolve));
        samples.push(performance.now() - round);
        peak = Math.max(peak, process.memoryUsage().heapUsed);
        decodes = Math.max(
          ...responses.map((response) => response.metrics?.decodes ?? 0),
        );
        if (
          responses.some(
            (response) =>
              response.response.item.result.rows.length !==
              rows.length * (streaming ? 8 : 1),
          )
        )
          throw new Error("Lost or duplicated rows");
      }
      const duration = performance.now() - start;
      global.gc();
      results.push({
        scenario: `${streaming ? "stream" : "unary"}-${concurrency}`,
        concurrency,
        streaming,
        p95Ms: samples.sort((a, b) => a - b)[Math.ceil(samples.length * 0.95) - 1],
        throughput: ((48 * concurrency) / duration) * 1000,
        heapGrowthBytes: Math.max(1, peak - before),
        retainedHeapBytes: Math.max(0, process.memoryUsage().heapUsed - before),
        wireCompression: fixtures[0].response.cmp,
        chunkCompression: fixtures[0].chunks[0].cmp,
        decodes,
        unhandledFailures: unhandledFailures.length - failuresBefore,
        residualListeners: [...transport.handlers.values()].reduce(
          (sum, set) => sum + set.size,
          0,
        ),
      });
      if (results.at(-1).residualListeners) throw new Error("Residual socket listeners");
    }
  console.log(JSON.stringify(results));
} else {
  await mkdir(path.dirname(output), { recursive: true });
  const repetitions = [];
  for (let repetition = 0; repetition < 9; repetition++) {
    const pair = {};
    for (const name of repetition % 2
      ? ["candidate", "baseline"]
      : ["baseline", "candidate"]) {
      const worker = spawnSync(
        process.execPath,
        [
          "--expose-gc",
          fileURLToPath(import.meta.url),
          "--worker",
          name === "baseline" ? baseline : candidate,
        ],
        { cwd: root, encoding: "utf8", timeout: 120_000 },
      );
      if (worker.status !== 0)
        throw new Error(`${name} benchmark failed: ${worker.stderr.slice(-2000)}`);
      pair[name] = JSON.parse(worker.stdout.trim().split("\n").at(-1));
    }
    repetitions.push(pair);
    console.log(`Completed isolated comparison ${repetition + 1}/9`);
  }
  const scenarios = repetitions[0].baseline.map((entry, index) => {
    const summarize = (name) =>
      Object.fromEntries(
        ["p95Ms", "throughput", "heapGrowthBytes", "retainedHeapBytes"].map((metric) => [
          metric,
          median(repetitions.map((pair) => pair[name][index][metric])),
        ]),
      );
    const base = summarize("baseline");
    const next = summarize("candidate");
    const ratios = {
      p95: next.p95Ms / base.p95Ms,
      throughput: next.throughput / base.throughput,
      heapGrowth: next.heapGrowthBytes / base.heapGrowthBytes,
    };
    const baselineFailures = repetitions.reduce(
      (sum, pair) => sum + pair.baseline[index].unhandledFailures,
      0,
    );
    const candidateFailures = repetitions.reduce(
      (sum, pair) => sum + pair.candidate[index].unhandledFailures,
      0,
    );
    const evaluation = baselineFailures
      ? "correctness-and-memory"
      : "performance-and-memory";
    return {
      scenario: entry.scenario,
      baseline: base,
      candidate: next,
      ratios,
      baselineFailures,
      candidateFailures,
      evaluation,
      passed:
        candidateFailures === 0 &&
        ratios.heapGrowth <= 1.1 &&
        (baselineFailures > 0 || (ratios.p95 <= 1.05 && ratios.throughput >= 0.85)),
    };
  });
  const report = {
    createdAt: new Date().toISOString(),
    node: process.version,
    repetitions: 9,
    methodology:
      "Alternating isolated Node processes; 8 warmup and 48 measured rounds; identical signed frames generated in a separate server process so each client imports only its own codec graph; 5ms simulated response latency; medians of nine runs; peak heap sampled after each completed round. No live server.",
    baseline,
    candidate,
    scenarios,
    runs: repetitions,
    passed: scenarios.every((entry) => entry.passed),
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.table(
    scenarios.map((entry) => ({
      scenario: entry.scenario,
      p95Ratio: entry.ratios.p95.toFixed(3),
      throughputRatio: entry.ratios.throughput.toFixed(3),
      heapRatio: entry.ratios.heapGrowth.toFixed(3),
      passed: entry.passed,
    })),
  );
  console.log(`Report: ${output}`);
  if (!report.passed) process.exitCode = 1;
}
