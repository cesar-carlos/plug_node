import { describe, expect, it } from "vitest";

import { PlugTimeoutError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import type { RelaySocketTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/relaySessionTypes";
import { createRelayStreamPullSession } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/streamPullSession";

class MockPullTransport implements RelaySocketTransport {
  connected = true;
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  on(event: string, handler: (payload: unknown) => void): void {
    const eventHandlers = this.handlers.get(event) ?? new Set();
    eventHandlers.add(handler);
    this.handlers.set(event, eventHandlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });
  }

  dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }
}

describe("createRelayStreamPullSession", () => {
  it("resolves matching pull_response window sizes", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport, {
      attachTerminalListeners: true,
    });

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 1_000,
      windowSize: 16,
    });

    expect(
      transport.emittedEvents.some((entry) => entry.event === "relay:rpc.stream.pull"),
    ).toBe(true);

    transport.dispatch("relay:rpc.stream.pull_response", {
      success: true,
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      windowSize: 32,
    });

    await expect(pullPromise).resolves.toBe(32);
    session.dispose();
  });

  it("rejects matching pull_response failures", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport);

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 1_000,
    });

    transport.dispatch("relay:rpc.stream.pull_response", {
      success: false,
      requestId: "req-1",
      streamId: "stream-1",
      error: {
        code: "STREAM_LOST",
        message: "Stream was lost",
      },
    });

    await expect(pullPromise).rejects.toMatchObject({
      code: "STREAM_LOST",
    });
    session.dispose();
  });

  it("times out pending pulls", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport, {
      attachTerminalListeners: false,
    });

    await expect(
      session.requestPull({
        conversationId: "conversation-1",
        requestId: "req-1",
        streamId: "stream-1",
        timeoutMs: 20,
      }),
    ).rejects.toBeInstanceOf(PlugTimeoutError);

    session.dispose();
  });

  it("rejects in-flight pulls on dispose and blocks later requestPull", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport);

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 5_000,
    });

    session.dispose();

    await expect(pullPromise).rejects.toMatchObject({
      code: "RELAY_STREAM_PULL_FAILED",
      message: expect.stringMatching(/disposed/i),
    });

    await expect(
      session.requestPull({
        conversationId: "conversation-1",
        requestId: "req-2",
        streamId: "stream-1",
        timeoutMs: 100,
      }),
    ).rejects.toMatchObject({
      code: "RELAY_STREAM_PULL_FAILED",
      message: expect.stringMatching(/already disposed/i),
    });
  });

  it("rejects pending pulls on terminal app:error when listeners are attached", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport, {
      attachTerminalListeners: true,
    });

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 5_000,
    });

    expect(transport.listenerCount("app:error")).toBe(1);

    transport.dispatch("app:error", {
      code: "TOKEN_EXPIRED",
      message: "token expired",
    });

    await expect(pullPromise).rejects.toBeTruthy();
    session.dispose();
  });

  it("skips terminal listeners when attachTerminalListeners is false", () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport, {
      attachTerminalListeners: false,
    });

    expect(transport.listenerCount("app:error")).toBe(0);
    expect(transport.listenerCount("connect_error")).toBe(0);
    expect(transport.listenerCount("disconnect")).toBe(0);
    expect(transport.listenerCount("relay:rpc.stream.pull_response")).toBe(1);

    session.dispose();
  });

  it("rejects all pending pulls when pull_response is malformed", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport);

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 5_000,
    });

    transport.dispatch("relay:rpc.stream.pull_response", { not: "valid" });

    await expect(pullPromise).rejects.toBeTruthy();
    session.dispose();
  });

  it("rejects malformed success pull_response (non-positive windowSize) for in-flight pulls", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport);

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 1_000,
    });

    transport.dispatch("relay:rpc.stream.pull_response", {
      success: true,
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      windowSize: 0,
    });

    await expect(pullPromise).rejects.toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
    });
    session.dispose();
  });

  it("ignores unmatched success responses and times out the pending pull", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport);

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 80,
    });

    transport.dispatch("relay:rpc.stream.pull_response", {
      success: true,
      conversationId: "conversation-1",
      requestId: "other-req",
      streamId: "stream-1",
      windowSize: 16,
    });

    await expect(pullPromise).rejects.toBeInstanceOf(PlugTimeoutError);
    session.dispose();
  });

  it("ignores failure responses that do not match pending ids", async () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport);

    const pullPromise = session.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 80,
    });

    transport.dispatch("relay:rpc.stream.pull_response", {
      success: false,
      requestId: "other-req",
      streamId: "stream-1",
      error: { code: "STREAM_LOST", message: "other stream" },
    });

    await expect(pullPromise).rejects.toBeInstanceOf(PlugTimeoutError);
    session.dispose();
  });

  it("rejects pending pulls on connect_error and disconnect when listeners are attached", async () => {
    const connectTransport = new MockPullTransport();
    const connectSession = createRelayStreamPullSession(connectTransport, {
      attachTerminalListeners: true,
    });
    const connectPromise = connectSession.requestPull({
      conversationId: "conversation-1",
      requestId: "req-1",
      streamId: "stream-1",
      timeoutMs: 5_000,
    });
    connectTransport.dispatch("connect_error", { message: "connect failed" });
    await expect(connectPromise).rejects.toBeTruthy();
    connectSession.dispose();

    const disconnectTransport = new MockPullTransport();
    const disconnectSession = createRelayStreamPullSession(disconnectTransport, {
      attachTerminalListeners: true,
    });
    const disconnectPromise = disconnectSession.requestPull({
      conversationId: "conversation-1",
      requestId: "req-2",
      streamId: "stream-1",
      timeoutMs: 5_000,
    });
    disconnectTransport.dispatch("disconnect", "io server disconnect");
    await expect(disconnectPromise).rejects.toBeTruthy();
    disconnectSession.dispose();
  });

  it("double dispose is a no-op", () => {
    const transport = new MockPullTransport();
    const session = createRelayStreamPullSession(transport, {
      attachTerminalListeners: true,
    });
    expect(transport.listenerCount("relay:rpc.stream.pull_response")).toBe(1);
    session.dispose();
    expect(transport.listenerCount("relay:rpc.stream.pull_response")).toBe(0);
    session.dispose();
    expect(transport.listenerCount("relay:rpc.stream.pull_response")).toBe(0);
  });
});
