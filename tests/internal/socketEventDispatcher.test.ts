import { afterEach, describe, expect, it, vi } from "vitest";
import {
  registerSocketCommand,
  disposeSocketEventDispatcher,
} from "../../shared/socket/socketEventDispatcher";
import * as codec from "../../shared/socket/payloadFrameCodec";
import type { RelaySocketTransport } from "../../shared/socket/relaySessionTypes";

class Transport implements RelaySocketTransport {
  connected = true;
  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();
  connect(): void {
    this.connected = true;
  }
  disconnect(): void {
    this.connected = false;
  }
  emit(): void {}
  on(event: string, handler: (payload: unknown) => void): void {
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }
  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }
  receive(event: string, data: unknown): void {
    for (const handler of [...(this.handlers.get(event) ?? [])]) handler(data);
  }
  listenerCount(): number {
    return [...this.handlers.values()].reduce((sum, handlers) => sum + handlers.size, 0);
  }
}

afterEach(() => vi.restoreAllMocks());

describe("connection socket event dispatcher", () => {
  it("should correlate concurrent conversation starts by agent and learn their conversation aliases", async () => {
    const transport = new Transport();
    const a = registerSocketCommand({ transport, ids: ["a"], agentId: "agent-a" });
    const b = registerSocketCommand({ transport, ids: ["b"], agentId: "agent-b" });
    const aStarted = vi.fn();
    const bStarted = vi.fn();
    const aAccepted = vi.fn();
    a.transport.on("relay:conversation.started", aStarted);
    b.transport.on("relay:conversation.started", bStarted);
    a.transport.on("relay:rpc.accepted", aAccepted);
    b.transport.on("relay:rpc.accepted", vi.fn());
    transport.receive("relay:conversation.started", {
      success: true,
      agentId: "agent-b",
      conversationId: "conv-b",
    });
    transport.receive("relay:conversation.started", {
      success: true,
      agentId: "agent-a",
      conversationId: "conv-a",
    });
    transport.receive("relay:rpc.accepted", {
      success: true,
      conversationId: "conv-a",
      requestId: "hub-a",
    });
    await a.drain();
    expect(aStarted).toHaveBeenCalledTimes(1);
    expect(bStarted).toHaveBeenCalledTimes(1);
    expect(aStarted).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-a" }),
    );
    expect(bStarted).toHaveBeenCalledWith(
      expect.objectContaining({ agentId: "agent-b" }),
    );
    expect(aAccepted).toHaveBeenCalledTimes(1);
    a.dispose();
    b.dispose();
    expect(transport.listenerCount()).toBe(0);
  });

  it("should isolate a reused operation from a cancelled decode and stale disposal", async () => {
    const transport = new Transport();
    const first = registerSocketCommand({ transport, ids: ["old"] });
    const oldDelivery = vi.fn();
    first.transport.on("relay:rpc.response", oldDelivery);
    const original = codec.decodePayloadFrameAsync;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(codec, "decodePayloadFrameAsync").mockImplementation(
      async (payload, options) => {
        if (
          options?.validateSignature &&
          (payload as { requestId?: string }).requestId === "old"
        )
          await gate;
        return original(payload, options);
      },
    );
    transport.receive(
      "relay:rpc.response",
      codec.encodePayloadFrame({ id: "old", result: 1 }, { requestId: "old" }),
    );
    first.dispose();
    const next = registerSocketCommand({ transport, ids: ["next"] });
    const nextDelivery = vi.fn();
    next.transport.on("relay:rpc.response", nextDelivery);
    first.dispose();
    first.transport.disconnect();
    first.transport.on("relay:rpc.response", oldDelivery);
    expect(transport.connected).toBe(true);
    transport.receive(
      "relay:rpc.response",
      codec.encodePayloadFrame({ id: "next", result: 2 }, { requestId: "next" }),
    );
    await next.drain();
    release();
    await Promise.resolve();
    expect(oldDelivery).not.toHaveBeenCalled();
    expect(nextDelivery).toHaveBeenCalledTimes(1);
    next.dispose();
    expect(transport.listenerCount()).toBe(0);
  });

  it.each([1, 4, 8])(
    "should decode each event once for %s concurrent command owners",
    async (count) => {
      const transport = new Transport();
      const deliveries = Array.from({ length: count }, () => vi.fn());
      const sessions = deliveries.map((receive, index) => {
        const session = registerSocketCommand({ transport, ids: [`client-${index}`] });
        session.transport.on("relay:rpc.response", receive);
        return session;
      });
      expect(transport.handlers.get("relay:rpc.response")?.size).toBe(1);
      for (let index = 0; index < count; index++)
        transport.receive(
          "relay:rpc.response",
          codec.encodePayloadFrame(
            { id: `client-${index}`, result: { rows: [index] } },
            { requestId: `hub-${index}` },
          ),
        );
      await sessions[0].drain();
      expect(sessions[0].metrics().decodes).toBe(count);
      for (const receive of deliveries) expect(receive).toHaveBeenCalledTimes(1);
      sessions.forEach((session) => session.dispose());
      expect(transport.listenerCount()).toBe(0);
      disposeSocketEventDispatcher(transport);
    },
  );

  it("should preserve event application order when decodes finish out of order", async () => {
    const transport = new Transport();
    const session = registerSocketCommand({ transport, ids: ["client"] });
    const order: number[] = [];
    session.transport.on("relay:rpc.chunk", (payload) => {
      void codec
        .decodePayloadFrameAsync<{ index: number }>(payload)
        .then((decoded) => order.push(decoded.data.index));
    });
    const original = codec.decodePayloadFrameAsync;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(codec, "decodePayloadFrameAsync").mockImplementation(
      async (payload, options) => {
        if (
          options?.validateSignature &&
          (payload as { traceId?: string }).traceId === "slow"
        )
          await gate;
        return original(payload, options);
      },
    );
    transport.receive(
      "relay:rpc.chunk",
      codec.encodePayloadFrame({ index: 1 }, { requestId: "client", traceId: "slow" }),
    );
    transport.receive(
      "relay:rpc.chunk",
      codec.encodePayloadFrame({ index: 2 }, { requestId: "client", traceId: "fast" }),
    );
    await Promise.resolve();
    expect(order).toEqual([]);
    release();
    await session.drain();
    expect(order).toEqual([1, 2]);
    session.dispose();
  });

  it("should reserve declared bytes and pending frames before decode starts", async () => {
    const transport = new Transport();
    const session = registerSocketCommand({
      transport,
      ids: ["client"],
      bufferLimits: { maxBufferedBytes: 100, maxBufferedChunkItems: 1 },
    });
    const error = vi.fn();
    const receive = vi.fn();
    session.transport.on("app:error", error);
    session.transport.on("relay:rpc.chunk", receive);
    transport.receive(
      "relay:rpc.chunk",
      codec.encodePayloadFrame({ rows: [] }, { requestId: "client" }),
    );
    transport.receive(
      "relay:rpc.chunk",
      codec.encodePayloadFrame({ rows: [] }, { requestId: "client" }),
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SOCKET_BUFFER_LIMIT" }),
    );
    session.dispose();
    await session.drain();
    expect(receive).not.toHaveBeenCalled();
    expect(transport.listenerCount()).toBe(0);
  });

  it("should enforce each batch item budget instead of borrowing another item's budget", () => {
    const transport = new Transport();
    const session = registerSocketCommand({
      transport,
      ids: ["a", "b"],
      bufferLimits: { maxBufferedBytes: 100 },
    });
    const error = vi.fn();
    session.transport.on("app:error", error);
    session.transport.on("relay:rpc.response", vi.fn());
    transport.receive(
      "relay:rpc.response",
      codec.encodePayloadFrame({ id: "a", result: "x".repeat(100) }, { requestId: "a" }),
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SOCKET_BUFFER_LIMIT" }),
    );
    session.dispose();
  });

  it("should adopt hub aliases and isolate mutable payloads by their owner", async () => {
    const transport = new Transport();
    const a = registerSocketCommand({ transport, ids: ["a"] });
    const b = registerSocketCommand({ transport, ids: ["b"] });
    const aChunks = vi.fn();
    const bChunks = vi.fn();
    a.transport.on("relay:rpc.accepted", vi.fn());
    b.transport.on("relay:rpc.accepted", vi.fn());
    a.transport.on("relay:rpc.chunk", aChunks);
    b.transport.on("relay:rpc.chunk", bChunks);
    transport.receive("relay:rpc.accepted", {
      success: true,
      conversationId: "conv",
      clientRequestId: "a",
      requestId: "hub-a",
    });
    transport.receive(
      "relay:rpc.chunk",
      codec.encodePayloadFrame({ rows: [1] }, { requestId: "hub-a" }),
    );
    await a.drain();
    expect(aChunks).toHaveBeenCalledTimes(1);
    expect(bChunks).not.toHaveBeenCalled();
    a.dispose();
    b.dispose();
  });

  it("should close all affected commands on an uncorrelated protocol failure", () => {
    const transport = new Transport();
    const sessions = ["a", "b"].map((id) =>
      registerSocketCommand({ transport, ids: [id] }),
    );
    const errors = sessions.map((session) => {
      const error = vi.fn();
      session.transport.on("app:error", error);
      session.transport.on("relay:rpc.accepted", vi.fn());
      return error;
    });
    transport.receive("relay:rpc.accepted", { requestId: "unknown" });
    errors.forEach((error) => expect(error).toHaveBeenCalledTimes(1));
    sessions.forEach((session) => session.dispose());
    expect(transport.listenerCount()).toBe(0);
  });

  it("should never trust a frame object reused and tampered with after delivery", async () => {
    const transport = new Transport();
    const signing = { key: "test-only-key", requireSignature: true };
    const session = registerSocketCommand({ transport, ids: ["a"], signing });
    const error = vi.fn();
    session.transport.on("app:error", error);
    session.transport.on("relay:rpc.chunk", vi.fn());
    const frame = codec.encodePayloadFrame({ rows: [1] }, { requestId: "a", signing });
    transport.receive("relay:rpc.chunk", frame);
    await session.drain();
    transport.receive("relay:rpc.chunk", { ...frame, requestId: "tampered" });
    await session.drain();
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringMatching(/signature/) }),
    );
    session.dispose();
  });

  it("should require a new signing context and ignore late responses after disposal", async () => {
    const transport = new Transport();
    const a = registerSocketCommand({ transport, ids: ["a"], signing: { key: "a" } });
    expect(() =>
      registerSocketCommand({ transport, ids: ["b"], signing: { key: "b" } }),
    ).toThrow(/signing context/);
    a.dispose();
    const b = registerSocketCommand({ transport, ids: ["b"], signing: { key: "a" } });
    const receive = vi.fn();
    b.transport.on("relay:rpc.response", receive);
    transport.receive(
      "relay:rpc.response",
      codec.encodePayloadFrame({ id: "a" }, { requestId: "a", signing: { key: "a" } }),
    );
    await b.drain();
    expect(receive).not.toHaveBeenCalled();
    b.dispose();
  });
});
