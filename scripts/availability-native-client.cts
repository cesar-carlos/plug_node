import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";

// Loaded only by the disposable Hub companion, never packaged in the npm artifact.
export async function verifyReferenceClient(options: any): Promise<void> {
  const built = process.env.PLUG_NODE_BUILT!;
  const { callActionIo } = require(join(built, "contracts/actionIo/client.js"));
  const { callSqlExtension } = require(join(built, "contracts/sqlOperation/client.js"));
  const { createRestActionIoTransport } = require(
    join(built, "rest/actionIoTransport.js"),
  );
  const { createSocketActionIoTransport } = require(
    join(built, "socket/actionIoTransport.js"),
  );
  const { serializeErrorForContinueOnFail } = require(
    join(built, "output/errorOutput.js"),
  );
  const { io } = options.requireServer("socket.io-client");
  const historical = process.env.PLUG_NODE_HISTORICAL === "true";
  const reports: object[] = [];
  async function configure(mode: string): Promise<void> {
    const request = join(options.root, "availability-control.json");
    const reply = join(options.root, "availability-control-result.json");
    if (existsSync(reply)) unlinkSync(reply);
    writeFileSync(request + ".next", JSON.stringify({ mode }));
    renameSync(request + ".next", request);
    const deadline = Date.now() + 20000;
    while (!existsSync(reply)) {
      if (Date.now() > deadline) throw Error("Native configuration deadline");
      await delay(50);
    }
    assert.equal(JSON.parse(readFileSync(reply, "utf8")).mode, mode);
    unlinkSync(reply);
  }
  for (const scenario of historical
    ? ["historical"]
    : ["disabled", "missing-handler", "local-disabled"]) {
    if (!historical) await configure(scenario);
    for (const mode of ["rest", "socket", "relay"]) {
      options.progress(`${scenario}:${mode}`);
      let socket: any;
      let transport: any;
      let sent = 0;
      let httpStatus: number | undefined;
      try {
        if (mode === "rest") {
          transport = createRestActionIoTransport({
            endpoint: `${options.hubUrl}/api/v1/agents/commands`,
            agentId: options.agentId,
            bearerToken: () => options.accessToken,
            fetch: async (url: string, init: RequestInit) => {
              sent++;
              const response = await fetch(url, init);
              httpStatus = response.status;
              return response;
            },
          });
        } else {
          socket = io(`${options.hubUrl}/consumers`, {
            transports: ["websocket"],
            auth: { token: options.accessToken },
            autoConnect: false,
            reconnection: false,
            forceNew: true,
            retries: 2,
            ackTimeout: 50,
          });
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
              () => reject(Error("Consumer readiness deadline")),
              10000,
            );
            socket.once("connection:ready", () => {
              clearTimeout(timer);
              resolve();
            });
            socket.once("connect_error", () => {
              clearTimeout(timer);
              reject(Error("Consumer refused"));
            });
            socket.connect();
          });
          let conversationId: string | undefined;
          if (mode === "relay")
            conversationId = await new Promise<string>((resolve, reject) => {
              const timer = setTimeout(
                () => reject(Error("Conversation deadline")),
                10000,
              );
              socket.once("relay:conversation.started", (body: any) => {
                clearTimeout(timer);
                if (!body.success) reject(Error("Conversation refused"));
                else resolve(body.conversationId);
              });
              socket.volatile.emit("relay:conversation.start", {
                agentId: options.agentId,
              });
            });
          transport = createSocketActionIoTransport({
            agentId: options.agentId,
            relayConversationId: conversationId,
            socket: {
              get connected() {
                return socket.connected;
              },
              get io() {
                return socket.io;
              },
              on: socket.on.bind(socket),
              off: socket.off.bind(socket),
              emit: socket.emit.bind(socket),
              volatile: {
                emit: (event: string, payload: unknown) => {
                  sent++;
                  return socket.volatile.emit(event, payload);
                },
              },
            },
          });
        }
        const cases =
          scenario === "missing-handler"
            ? ["method"]
            : scenario === "local-disabled"
              ? ["handler"]
              : historical
                ? ["io", "sql", "catalog"]
                : ["io", "sql"];
        for (const kind of cases) {
          const method =
            kind === "catalog"
              ? "agent.action.listAvailable"
              : kind === "sql"
                ? "sql.operation.cancel"
                : kind === "method"
                  ? "agent.action.getExecution"
                  : kind === "handler"
                    ? "agent.action.sendInput"
                    : "agent.action.run";
          const before = options.dispatchCount(method);
          const sentBefore = sent;
          let failure: any;
          try {
            if (kind === "catalog")
              await callActionIo(
                transport,
                "listAvailable",
                { page_size: 1 },
                options.credential,
              );
            else if (kind === "sql")
              await callSqlExtension(
                transport,
                "sql.operation.cancel",
                {
                  contractVersion: 1,
                  operationId: randomUUID(),
                  fingerprint: "a".repeat(64),
                  sourcePhysicalId: "b".repeat(64),
                  database: "fixture",
                },
                options.credential,
              );
            else if (kind === "handler")
              await callActionIo(
                transport,
                "sendInput",
                {
                  execution_id: "disabled-fixture",
                  message_id: "must-not-write",
                  sequence: 0,
                  data_base64: "AQ==",
                },
                options.credential,
              );
            else if (kind === "method")
              await callActionIo(
                transport,
                "getExecution",
                { execution_id: "unimplemented-fixture" },
                options.credential,
              );
            else
              await callActionIo(
                transport,
                "run",
                {
                  action_id: options.actionId,
                  idempotency_key: `must-not-run-${randomUUID()}`,
                  io: { version: 1, mode: "faithful", close_input: true },
                },
                options.credential,
              );
            assert.fail("Unavailable operation unexpectedly succeeded");
          } catch (error) {
            failure = error;
          }
          const output = serializeErrorForContinueOnFail(failure);
          options.progress(
            `${scenario}:${mode}:${method}:client=${sent - sentBefore}:agent=${options.dispatchCount(method) - before}:code=${output.code}:reason=${output.details?.reason}`,
          );
          assert.equal(output.retryable, false);
          assert.equal(output.details.outcome_unknown, false);
          assert.equal(output.details.effects_possible, false);
          assert.match(
            output.message,
            kind === "method" ? /não está implementado/ : /indisponível|desativado/,
          );
          assert.ok(!JSON.stringify(output).includes(options.credential));
          assert.equal(output.technicalMessage, undefined);
          if (kind === "method") assert.equal(output.details.rpc_code, -32601);
          else {
            assert.equal(
              output.details.failure_code ?? output.code,
              "CAPABILITY_UNAVAILABLE",
            );
            if (kind === "catalog") assert.equal(output.details.reason, "not_advertised");
            else
              assert.ok(["not_advertised", "disabled"].includes(output.details.reason));
            assert.equal(output.details.origin, "agent");
            assert.equal(output.details.phase, "preflight");
            assert.equal(output.details.recovery, "local_intervention");
            assert.equal(
              output.details.capability,
              kind === "catalog"
                ? "agentActions.catalog v1"
                : kind === "sql"
                  ? "sqlOperations v1"
                  : "agentActions.io v1",
            );
          }
          // Exceed the configured Socket.IO ACK retry horizon: no delayed replay.
          await delay(250);
          assert.equal(sent - sentBefore, 1);
          const dispatched = kind === "method" || kind === "handler" ? 1 : 0;
          assert.equal(options.dispatchCount(method) - before, dispatched);
          if (mode === "rest" && dispatched === 0) assert.equal(httpStatus, 409);
          if (historical && kind !== "catalog")
            assert.equal(output.details.reason, "not_advertised");
          if (kind === "handler") {
            assert.equal(output.details.reason, "disabled");
            assert.match(output.message, /desativado/);
          }
          reports.push({
            scenario,
            mode,
            kind,
            code: output.code,
            httpStatus,
            details: output.details,
            message: output.message,
            clientDispatches: 1,
            agentDispatches: dispatched,
          });
        }
      } finally {
        transport?.dispose?.();
        socket?.disconnect();
      }
    }
  }
  if (!historical) await configure("enabled");
  writeFileSync(
    join(options.root, "availability-report.json"),
    JSON.stringify({ historical, cases: reports }, null, 2),
  );
  console.log(
    `PASS: native availability matrix (${reports.length} cases); one client dispatch, no preflight agent dispatch.`,
  );
}
