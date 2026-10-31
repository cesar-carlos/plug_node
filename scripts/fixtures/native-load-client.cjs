const assert = require("node:assert/strict");
const { fork, spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const { join, resolve } = require("node:path");
const { createInterface } = require("node:readline");
const { readFileSync, writeFileSync, rmSync } = require("node:fs");
const { setTimeout: delay } = require("node:timers/promises");
const repo = resolve(__dirname, "../.."),
  scratch = join(repo, "tmp/native-load");
const dist = join(repo, "packages/n8n-nodes-plug-database/dist/generated/shared");
const { callActionIo, nextActionIoOffsets } = require(
  join(dist, "contracts/actionIo/client.js"),
);
const { openActionIoConnection } = require(join(dist, "socket/actionIoConnection.js"));
const { createRestActionIoTransport } = require(join(dist, "rest/actionIoTransport.js"));
const { io } = require("socket.io-client");

exports.verifyReferenceClient = ({ hubUrl, agentId, accessToken, credential }) =>
  new Promise((done, fail) => {
    const child = fork(__filename, [], {
      stdio: ["ignore", "inherit", "inherit", "ipc"],
      windowsHide: true,
    });
    child.once("error", fail);
    child.once("exit", (code) =>
      code === 0 ? done() : fail(Error("Load client failed: " + code)),
    );
    child.send({
      hubUrl,
      agentId,
      accessToken,
      credential,
      agentPid: Number(readFileSync("agent.pid", "utf8")),
      hubPid: process.pid,
    });
  });

function distribution(values) {
  values.sort((a, b) => a - b);
  return {
    n: values.length,
    p50: values[Math.ceil(values.length * 0.5) - 1],
    p95: values[Math.ceil(values.length * 0.95) - 1],
    max: values.at(-1),
  };
}
async function exercise(channel, options) {
  const childFile = join(scratch, "child.pid");
  rmSync(childFile, { force: true });
  const rss = {},
    firstWorkingSetBytes = {},
    samples = {};
  const sampler = spawn(
    "powershell.exe",
    [
      "-NoProfile",
      "-File",
      join(__dirname, "native-load-rss.ps1"),
      process.pid,
      options.hubPid,
      options.agentPid,
      childFile,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "inherit"] },
  );
  const closed = new Promise((done, fail) => {
    sampler.once("close", done);
    sampler.once("error", fail);
  });
  createInterface({ input: sampler.stdout }).on("line", (line) => {
    for (const [role, bytes] of Object.entries(JSON.parse(line))) {
      firstWorkingSetBytes[role] ??= bytes;
      rss[role] = Math.max(rss[role] ?? 0, bytes);
      samples[role] = (samples[role] ?? 0) + 1;
    }
  });
  let transport, abort, resetProxy;
  function disconnect() {
    abort?.abort();
    transport?.dispose?.();
  }
  async function connect() {
    if (channel === "rest") {
      abort = new AbortController();
      transport = createRestActionIoTransport({
        endpoint: (resetProxy?.url ?? options.hubUrl) + "/api/v1/agents/commands",
        agentId: options.agentId,
        bearerToken: () => options.accessToken,
        signal: abort.signal,
      });
    } else {
      transport = await openActionIoConnection(
        io((resetProxy?.url ?? options.hubUrl) + "/consumers", {
          transports: ["websocket"],
          autoConnect: false,
          reconnection: false,
          forceNew: true,
          auth: { token: options.accessToken },
        }),
        options.agentId,
        channel === "relay",
      );
    }
  }
  const call = (method, params) =>
    callActionIo(transport, method, params, options.credential);
  try {
    const deadline = performance.now() + 5000;
    while (!samples.agent && performance.now() < deadline) await delay(25);
    assert.ok(
      samples.agent && samples.client && samples.hub,
      "RSS sampler did not initialize",
    );
    await connect();
    const started = performance.now(),
      key = randomUUID(),
      blockSize = 65536,
      blocks = 64;
    const run = await call("run", {
      action_id: "action",
      trigger_id: "trigger",
      idempotency_key: key,
      io: { version: 1, mode: "faithful", close_input: false },
    });
    const id = run.execution_id,
      identity = { execution_id: id };
    const expected = createHash("sha256"),
      hashes = { stdout: createHash("sha256"), stderr: createHash("sha256") };
    const sendMs = [],
      readMs = [],
      sentAt = [],
      pacedEchoMs = [];
    let sequence = 0,
      offsets = { stdout: 0, stderr: 0 },
      reconnected = false,
      checkpoint,
      inputsReceiptedAtReset,
      childPidAtReset,
      overlap = false,
      written = 0;
    // Use a separate reader connection so reconnecting never interrupts an in-flight write.
    const writer = transport;
    const writerAbort = abort;
    if (process.env.PLUG_LOAD_TCP_RESET === "1")
      resetProxy = await require("./rest-load-reset.cjs").openResetProxy(options.hubUrl);
    if (process.env.PLUG_LOAD_TCP_RESET === "socket")
      resetProxy = await require("./socket-load-reset.cjs").openResetProxy(
        options.hubUrl,
        channel,
      );
    await connect();
    try {
      await Promise.all([
        (async () => {
          for (let n = 0; n < blocks; n++) {
            const data = Buffer.alloc(blockSize, n);
            expected.update(data);
            const t = performance.now();
            sentAt[n] = t;
            const message_id = randomUUID();
            const receipt = await callActionIo(
              writer,
              "sendInput",
              {
                ...identity,
                message_id,
                sequence: n,
                data_base64: data.toString("base64"),
              },
              options.credential,
            );
            assert.ok(["written", "accepted", "writing"].includes(receipt.state));
            sendMs.push(performance.now() - t);
            written++;
            if (n % 4 === 3) {
              let status = receipt;
              const deadline = performance.now() + 15000;
              while (
                ["accepted", "writing"].includes(status.state) &&
                performance.now() < deadline
              ) {
                await delay(25);
                status = await callActionIo(
                  writer,
                  "getInputStatus",
                  { ...identity, message_id },
                  options.credential,
                );
              }
              assert.equal(status.state, "written");
            }
            // Let the echo process start before saturating its input queue.
            if (n < 8) await delay(n === 0 ? 500 : 180);
          }
          await callActionIo(
            writer,
            "closeInput",
            { ...identity, message_id: randomUUID(), sequence: blocks },
            options.credential,
          );
        })(),
        (async () => {
          while (true) {
            const t = performance.now();
            const readParams = {
              ...identity,
              after_sequence: sequence,
              wait_ms: 2000,
              max_bytes: 65536,
            };
            if (resetProxy && checkpoint && !reconnected) {
              assert.deepEqual({ sequence, ...offsets }, checkpoint);
              inputsReceiptedAtReset = written;
              assert.ok(written > 0 && written < blocks);
              childPidAtReset = Number(readFileSync(childFile, "utf8"));
              assert.ok(childPidAtReset > 0);
              resetProxy.arm();
              await assert.rejects(call("readIo", readParams), {
                code:
                  channel === "rest" ? "TRANSPORT_UNCONFIRMED" : "SOCKET_DISCONNECTED",
                details: {
                  outcome_unknown: false,
                  effects_possible: false,
                  retryable: false,
                },
              });
              disconnect();
              await delay(100);
              await connect();
              reconnected = true;
            }
            const page = await call("readIo", readParams);
            readMs.push(performance.now() - t);
            offsets = nextActionIoOffsets(page, offsets);
            for (const e of page.events) {
              assert.equal(e.sequence, ++sequence);
              if (e.type === "output") {
                const bytes = Buffer.from(e.data_base64, "base64");
                hashes[e.stream].update(bytes);
                if (written < blocks) overlap = true;
                if (e.stream === "stdout")
                  for (
                    let end = Math.floor(e.offset / blockSize) + 1;
                    end <= Math.floor((e.offset + bytes.length) / blockSize) && end <= 8;
                    end++
                  ) {
                    if (end > 1) pacedEchoMs.push(performance.now() - sentAt[end - 1]);
                  }
              }
            }
            assert.equal(page.next_sequence, sequence);
            if (page.events.some((e) => e.type === "completed")) {
              assert.ok(page.terminal && page.output_complete);
              break;
            }
            if (
              !checkpoint &&
              offsets.stdout &&
              offsets.stderr &&
              (!resetProxy || written >= 16)
            ) {
              checkpoint = { sequence, ...offsets };
              if (!resetProxy) {
                disconnect();
                await delay(100);
                await connect();
                reconnected = true;
              }
            }
            await delay(45);
          }
        })(),
      ]);
    } finally {
      writerAbort?.abort();
      writer.dispose?.();
    }
    const durationMs = performance.now() - started;
    const sha256 = expected.digest("hex");
    for (const stream of ["stdout", "stderr"]) {
      assert.equal(offsets[stream], blocks * blockSize);
      assert.equal(hashes[stream].digest("hex"), sha256);
    }
    assert.ok(reconnected && overlap);
    if (resetProxy)
      assert.equal(Number(readFileSync(childFile, "utf8")), childPidAtReset);
    for (const role of ["client", "agent", "hub", "child"])
      assert.ok(samples[role] > 0, role + " RSS missing");
    assert.equal(pacedEchoMs.length, 7);
    return {
      channel,
      blocks,
      blockSize,
      offsets,
      sha256,
      checkpoint,
      ...(resetProxy
        ? {
            tcpReset: {
              ...resetProxy.evidence(),
              inputsReceiptedAtReset,
              childPidAtReset,
            },
            executionId: id,
          }
        : {}),
      sequence,
      durationMs,
      outputMiBps: (offsets.stdout + offsets.stderr) / 1048576 / (durationMs / 1000),
      sendMs: distribution(sendMs),
      readMs: distribution(readMs),
      pacedEchoMs: distribution(pacedEchoMs),
      firstWorkingSetBytes,
      peakWorkingSetBytes: rss,
      samples,
    };
  } finally {
    disconnect();
    await resetProxy?.close();
    sampler.kill();
    await closed;
  }
}
if (require.main === module)
  process.once("message", async (options) => {
    try {
      assert.equal(new URL(options.hubUrl).hostname, "127.0.0.1");
      const rows = [];
      const tcpReset = process.env.PLUG_LOAD_TCP_RESET === "1";
      const socketReset = process.env.PLUG_LOAD_TCP_RESET === "socket";
      for (const channel of socketReset
        ? ["socket", "relay"]
        : tcpReset
          ? ["rest"]
          : ["socket", "rest"])
        rows.push(await exercise(channel, options));
      writeFileSync(
        join(
          scratch,
          socketReset
            ? "socket-tcp-reset.json"
            : tcpReset
              ? "rest-tcp-reset.json"
              : `load-${Date.now()}.json`,
        ),
        JSON.stringify(rows, null, 2),
      );
    } catch (e) {
      writeFileSync(
        join(scratch, "load-error.txt"),
        String(e.code) +
          " " +
          e.message +
          " " +
          e.stack?.split("\n").find((line) => line.includes("native-load-client.cjs:")),
      );
      console.error("load failed", e.code ?? e.message);
      process.exitCode = 1;
    } finally {
      process.disconnect();
    }
  });
