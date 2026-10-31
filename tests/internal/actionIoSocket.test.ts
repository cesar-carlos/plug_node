import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createSocketActionIoTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/actionIoTransport";
import {
  encodePayloadFrame,
  decodePayloadFrame,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import { callActionIo } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";

class SocketFixture extends EventEmitter {
  connected = true;
  io = { engine: { transport: { writable: true } } };
  sent: { event: string; body: Record<string, unknown> }[] = [];
  volatile = {
    emit: (event: string, body: Record<string, unknown>): void => {
      this.sent.push({ event, body });
    },
  };
}
afterEach(() => vi.useRealTimers());
describe.each([false, true])("single-dispatch Socket relay=%s", (relay) => {
  it("enforces the configured command budget in UTF-8 bytes before emission", async () => {
    const socket = new SocketFixture();
    const params = { action_id: 'ação"\\', idempotency_key: "k" };
    const prototype = {
      jsonrpc: "2.0",
      id: "x".repeat(36),
      method: "agent.action.findExecution",
      params: { ...params, client_token: "token" },
    };
    const size = Buffer.byteLength(JSON.stringify(prototype));
    const run = (maxRequestBytes: number) =>
      createSocketActionIoTransport({
        socket,
        agentId: "a",
        relayConversationId: relay ? "c" : undefined,
        maxRequestBytes,
      });
    const small = run(size - 1);
    await expect(
      callActionIo(small, "findExecution", params, "token"),
    ).rejects.toMatchObject({
      code: "SOCKET_REQUEST_TOO_LARGE",
      details: { outcome_unknown: false },
    });
    expect(socket.sent).toHaveLength(0);
    small.dispose();
    const exact = run(size);
    const pending = callActionIo(exact, "findExecution", params, "token");
    expect(socket.sent).toHaveLength(1);
    const wire = socket.sent[0].body;
    const command = relay ? decodePayloadFrame(wire.frame).data : wire.command;
    expect(command).toMatchObject({ ...prototype, id: expect.any(String) });
    const checked = expect(pending).rejects.toMatchObject({
      code: "SOCKET_DISCONNECTED",
    });
    socket.emit("disconnect");
    await checked;
    exact.dispose();
  });
  it("does not emit when a delayed flush runs after the dispatch deadline", async () => {
    vi.useFakeTimers();
    const clock = vi.spyOn(performance, "now").mockReturnValue(0);
    const socket = new SocketFixture();
    socket.io.engine.transport.writable = false;
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      relayConversationId: relay ? "c" : undefined,
    });
    try {
      const pending = transport({
        jsonrpc: "2.0",
        id: "expired",
        method: "agent.action.run",
        params: {},
      });
      clock.mockReturnValue(30001);
      socket.io.engine.transport.writable = true;
      vi.advanceTimersByTime(5);
      await expect(pending).rejects.toMatchObject({
        code: "SOCKET_TIMEOUT",
        details: { outcome_unknown: false },
      });
      expect(socket.sent).toHaveLength(0);
    } finally {
      transport.dispose();
      clock.mockRestore();
    }
  });
  it("sends the validated input even if the caller changes the pending run", async () => {
    vi.useFakeTimers();
    const socket = new SocketFixture();
    socket.io.engine.transport.writable = false;
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      relayConversationId: relay ? "c" : undefined,
    });
    try {
      const io = {
        version: 1,
        mode: "faithful",
        close_input: true,
        initial_input_base64: "AA==",
      };
      const pending = callActionIo(
        transport,
        "run",
        { action_id: "a", idempotency_key: "k", io },
        "token",
      );
      io.initial_input_base64 = "/w==";
      socket.io.engine.transport.writable = true;
      vi.advanceTimersByTime(5);
      const wire = socket.sent[0].body;
      const command = relay ? decodePayloadFrame(wire.frame).data : wire.command;
      expect(command).toMatchObject({ params: { io: { initial_input_base64: "AA==" } } });
      socket.emit("disconnect");
      await expect(pending).rejects.toMatchObject({ code: "SOCKET_DISCONNECTED" });
    } finally {
      transport.dispose();
    }
  });
  it("ignores correlated replies until the first dispatch", async () => {
    vi.useFakeTimers();
    const socket = new SocketFixture();
    socket.io.engine.transport.writable = false;
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      relayConversationId: relay ? "c" : undefined,
    });
    const pending = transport({
      jsonrpc: "2.0",
      id: "x",
      method: "agent.action.run",
      params: {},
    });
    const reply = (result: string) =>
      socket.emit(
        relay ? "relay:rpc.response" : "agents:command_response",
        encodePayloadFrame(
          relay
            ? { id: "x", jsonrpc: "2.0", result }
            : {
                agentId: "a",
                response: { type: "single", item: { id: "x", success: true, result } },
              },
        ),
      );
    if (!relay)
      socket.emit(
        "agents:command_response",
        encodePayloadFrame({ agentId: "a", requestId: "x", error: { code: "EARLY" } }),
      );
    reply("early");
    expect(socket.sent).toHaveLength(0);
    socket.io.engine.transport.writable = true;
    vi.advanceTimersByTime(5);
    reply("actual");
    await expect(pending).resolves.toMatchObject({ result: "actual" });
    expect(socket.sent).toHaveLength(1);
    transport.dispose();
  });
  it("does not replay on ACK loss, disconnect or reconnect", async () => {
    const socket = new SocketFixture();
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      relayConversationId: relay ? "c" : undefined,
    });
    const result = callActionIo(
      transport,
      "sendInput",
      { execution_id: "e", message_id: "m", sequence: 0, data_base64: "AP8=" },
      "token",
    );
    const checked = expect(result).rejects.toMatchObject({
      details: { outcome_unknown: true },
      retryable: false,
    });
    socket.emit("disconnect");
    socket.emit("connect");
    await checked;
    expect(socket.sent).toHaveLength(1);
    transport.dispose();
    expect(socket.listenerCount("disconnect")).toBe(0);
  });
  it("marks interrupted output reads as having no process effects", async () => {
    const socket = new SocketFixture();
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      relayConversationId: relay ? "c" : undefined,
    });
    const pending = transport({
      jsonrpc: "2.0",
      id: "r",
      method: "agent.action.readIo",
      params: { wait_ms: 100 },
    });
    socket.emit("disconnect");
    await expect(pending).rejects.toMatchObject({
      code: "SOCKET_DISCONNECTED",
      details: { outcome_unknown: false, effects_possible: false },
    });
    expect(socket.sent).toHaveLength(1);
    transport.dispose();
  });
  it("lets input through while a long read is pending and ignores ACKs", async () => {
    const socket = new SocketFixture();
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      relayConversationId: relay ? "c" : undefined,
    });
    const read = transport({
      jsonrpc: "2.0",
      id: "read",
      method: "agent.action.readIo",
      params: { wait_ms: 20000 },
    });
    const write = transport({
      jsonrpc: "2.0",
      id: "write",
      method: "agent.action.sendInput",
      params: {},
    });
    expect(socket.sent).toHaveLength(2);
    for (const id of ["write", "read"]) {
      const envelope = relay
        ? { jsonrpc: "2.0", id, result: {} }
        : {
            agentId: "a",
            response: { type: "single", item: { id, success: true, result: {} } },
          };
      socket.emit(
        relay ? "relay:rpc.response" : "agents:command_response",
        encodePayloadFrame(envelope),
      );
    }
    await Promise.all([read, write]);
    transport.dispose();
    if (relay)
      expect(decodePayloadFrame(socket.sent[0].body.frame).data).toMatchObject({
        id: "read",
      });
  });
  it("distinguishes a disconnected unsent request from uncertain dispatch", async () => {
    const socket = new SocketFixture();
    socket.connected = false;
    const transport = createSocketActionIoTransport({ socket, agentId: "a" });
    await expect(
      transport({ jsonrpc: "2.0", id: "x", method: "agent.action.cancel", params: {} }),
    ).rejects.toMatchObject({ details: { outcome_unknown: false } });
    expect(socket.sent).toHaveLength(0);
    transport.dispose();
  });
});
it("settles only the correlated relay preflight refusal without another emission", async () => {
  const socket = new SocketFixture();
  const transport = createSocketActionIoTransport({
    socket,
    agentId: "a",
    relayConversationId: "c",
  });
  const command = {
    jsonrpc: "2.0" as const,
    id: "blocked",
    method: "agent.action.run",
    params: {},
  };
  const blocked = transport(command);
  const allowed = transport({ ...command, id: "allowed" });
  const error = {
    code: "CAPABILITY_UNAVAILABLE",
    message: "private",
    details: { reason: "disabled", effects_possible: false },
  };
  const refusal = {
    success: false,
    conversationId: "c",
    clientRequestId: "blocked",
    error,
  };
  socket.emit("relay:rpc.accepted", {
    ...refusal,
    conversationId: "other",
    error: { code: "WRONG_CONVERSATION" },
  });
  socket.emit("relay:rpc.accepted", {
    ...refusal,
    clientRequestId: "allowed",
    success: true,
  });
  socket.emit("relay:rpc.accepted", refusal);
  await expect(blocked).rejects.toMatchObject({
    code: error.code,
    retryable: false,
    details: { outcome_unknown: false },
  });
  socket.emit(
    "relay:rpc.response",
    encodePayloadFrame({ jsonrpc: "2.0", id: "allowed", result: {} }),
  );
  await expect(allowed).resolves.toMatchObject({ id: "allowed" });
  expect(socket.sent).toHaveLength(2);
  transport.dispose();
  expect(socket.listenerCount("relay:rpc.accepted")).toBe(0);
});
it("preserves the Hub's structured dispatch error", async () => {
  const socket = new SocketFixture();
  const transport = createSocketActionIoTransport({ socket, agentId: "a" });
  const pending = transport({
    jsonrpc: "2.0",
    id: "x",
    method: "agent.action.cancel",
    params: {},
  });
  socket.emit(
    "agents:command_response",
    encodePayloadFrame({
      requestId: "x",
      success: false,
      error: {
        code: "ACTION_OUTCOME_UNKNOWN",
        details: {
          diagnostic_id: "d",
          confirmed_bytes: null,
          effects_possible: false,
          outcome_unknown: true,
        },
      },
    }),
  );
  await expect(pending).rejects.toMatchObject({
    code: "ACTION_OUTCOME_UNKNOWN",
    details: { diagnostic_id: "d", confirmed_bytes: null, outcome_unknown: true },
  });
  transport.dispose();
});
