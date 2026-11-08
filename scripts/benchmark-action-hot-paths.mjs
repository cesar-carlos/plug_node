import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Compare saved, unminified build output with the candidate, without network I/O.
const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const script = fileURLToPath(import.meta.url);
if (process.argv[2] !== "--worker") {
  const base = resolve(process.argv[2] ?? "tmp/hot-path-baseline/shared");
  const candidate = resolve("packages/n8n-nodes-plug-database/dist/generated/shared");
  const reports = { base: [], candidate: [] };
  for (let pair = 0; pair < 3; pair++) {
    for (const label of pair % 2 ? ["candidate", "base"] : ["base", "candidate"]) {
      const child = spawnSync(
        process.execPath,
        [script, "--worker", label === "base" ? base : candidate, label],
        { encoding: "utf8" },
      );
      assert.equal(child.status, 0, child.stderr);
      reports[label].push(JSON.parse(child.stdout));
    }
  }
  const results = Object.keys(reports.base[0]).map((name) => {
    const before = median(reports.base.map((r) => r[name]));
    const after = median(reports.candidate.map((r) => r[name]));
    return {
      name,
      beforeMs: before,
      afterMs: after,
      reductionPercent: 100 * (1 - after / before),
    };
  });
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        pairs: 3,
        measuredBatches: 7,
        warmupBatches: 1,
        results,
        reports,
      },
      null,
      2,
    ),
  );
} else {
  const root = resolve(process.argv[3]);
  const req = createRequire(resolve(root, "benchmark.cjs"));
  const hints = req("./n8n/plugSqlPerformanceHints.js");
  const { nextActionIoOffsets, ActionIoError } = req("./contracts/actionIo/client.js");
  const filename = resolve(root, "n8n/actionIoExecution.js");
  const mod = { exports: {} };
  // Expose only the existing private helper in this isolated measurement process.
  new Function(
    "require",
    "exports",
    "module",
    readFileSync(filename, "utf8") + "\nexports.benchReadInput = readInput;",
  )(createRequire(filename), mod.exports, mod);
  const readInput = mod.exports.benchReadInput;
  const socketSource = readFileSync(resolve(root, "socket/actionIoTransport.js"), "utf8");
  const start = socketSource.indexOf("const waitingRead =");
  const end = socketSource.indexOf("const payload =", start);
  assert.ok(start >= 0 && end > start, "Cannot locate reader admission in build");
  const admit = new Function(
    "pending",
    "command",
    "client_1",
    socketSource.slice(start, end),
  );
  const pending = new Map(
    Array.from({ length: 31 }, (_, i) => [i, { waitingRead: i % 2 === 0 }]),
  );
  const command = { method: "agent.action.readIo", params: { wait_ms: 1 } };
  const results = {};
  const measure = async (name, count, run) => {
    const batches = [];
    for (let batch = 0; batch < 8; batch++) {
      const startTime = performance.now();
      for (let i = 0; i < count; i++) await run();
      if (batch) batches.push(performance.now() - startTime);
    }
    results[name] = median(batches);
  };
  const sql =
    "SELECT TOP (1000) 'ação 🌱' AS label /*" + "comment ".repeat(1000) + "*/ FROM t";
  await measure("sql-10000", 10000, () =>
    assert.equal(hints.shouldAutoPreferDbStreaming(sql), true),
  );
  for (const size of [11, 65536]) {
    for (const chunkSize of size === 11 ? [11] : [65536, 256]) {
      const data = Buffer.alloc(size, 0xa5);
      const chunks = [];
      for (let offset = 0; offset < size; offset += chunkSize)
        chunks.push(data.subarray(offset, offset + chunkSize));
      const context = {
        getNodeParameter: (name) => (name === "actionInputFormat" ? "binary" : "data"),
        helpers: {
          assertBinaryData: () => ({ id: "fixture" }),
          getBinaryStream: async () => ({
            async *[Symbol.asyncIterator]() {
              yield* chunks;
            },
            destroy() {},
          }),
        },
      };
      const expected = data.toString("base64");
      await measure(`binary-${size}-${chunkSize}-500`, 500, async () =>
        assert.equal(await readInput(context, 0), expected),
      );
    }
  }
  const events = Array.from({ length: 128 }, (_, i) => ({
    type: "output",
    sequence: i + 1,
    stream: "stdout",
    offset: i,
    data_base64: "YQ==",
  }));
  const page = { events, next_sequence: 128 };
  await measure("page-preflight-100000", 100000, () => {
    const result = nextActionIoOffsets(page, { stdout: 0, stderr: 0 }, 0);
    if (nextActionIoOffsets.length < 3) {
      let expected = 0;
      let completed = false;
      for (const event of events) {
        if (completed || event.sequence !== ++expected) throw Error("sequence");
        completed = event.type === "completed";
      }
      assert.equal(page.next_sequence, expected);
    }
    assert.equal(result.stdout, 128);
  });
  // 15 waiting readers among 31 total: scan all entries without exception overhead.
  pending.get(30).waitingRead = false;
  await measure("reader-admission-200000", 200000, () =>
    admit(pending, command, { ActionIoError }),
  );
  console.log(JSON.stringify(results));
}
