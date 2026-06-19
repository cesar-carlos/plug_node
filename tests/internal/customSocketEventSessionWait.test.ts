import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlugTimeoutError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  waitForConnectionReady,
  waitForControlAck,
  waitForPublishedAck,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/customSocketEventSessionWait";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import type { CustomSocketEventTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/customSocketEventSessionTypes";

class MockWaitTransport implements CustomSocketEventTransport {
  connected = false;

  readonly id = "socket-wait-1";

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  on(event: string, handler: (payload: unknown) => void): void {
    const handlers = this.handlers.get(event) ?? new Set();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    const handlers = this.handlers.get(event);
    if (!handlers) {
      return;
    }

    for (const handler of handlers) {
      handler(payload);
    }
  }

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  dispatch(event: string, payload?: unknown): void {
    this.emit(event, payload);
  }
}

describe("customSocketEventSessionWait", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resolves waitForConnectionReady when connection:ready arrives", async () => {
    const transport = new MockWaitTransport();
    const readyFrame = encodePayloadFrame(
      {
        id: "socket-wait-1",
        message: "ready",
        user: { sub: "client-1" },
      },
      { requestId: "handshake", compression: "none" },
    );

    const readyPromise = waitForConnectionReady(transport, 5_000);
    transport.dispatch("connection:ready", readyFrame);

    await expect(readyPromise).resolves.toMatchObject({
      id: "socket-wait-1",
      message: "ready",
    });
  });

  it("rejects waitForConnectionReady on timeout", async () => {
    const transport = new MockWaitTransport();
    const readyPromise = waitForConnectionReady(transport, 25);
    const rejection = expect(readyPromise).rejects.toBeInstanceOf(PlugTimeoutError);

    await vi.advanceTimersByTimeAsync(30);
    await rejection;
  });

  it("resolves waitForControlAck for a matching subscribe ack", async () => {
    const transport = new MockWaitTransport();
    const ackPromise = waitForControlAck({
      transport,
      requestEvent: "socket:event.subscribe",
      responseEvent: "socket:event.subscribed",
      requestId: "subscribe-1",
      eventName: "client:custom.orders",
      expectedSubscribed: true,
      timeoutMs: 5_000,
    });

    transport.dispatch("socket:event.subscribed", {
      success: true,
      requestId: "subscribe-1",
      data: {
        eventName: "client:custom.orders",
        subscribed: true,
      },
    });

    await expect(ackPromise).resolves.toBeUndefined();
  });

  it("resolves waitForPublishedAck with the published event response", async () => {
    const transport = new MockWaitTransport();
    const ackPromise = waitForPublishedAck({
      transport,
      requestId: "publish-1",
      timeoutMs: 5_000,
    });

    transport.dispatch("socket:event.published", {
      success: true,
      requestId: "publish-1",
      data: {
        eventId: "event-1",
        eventName: "client:custom.orders",
        recipients: 2,
        idempotentReplay: false,
      },
    });

    await expect(ackPromise).resolves.toMatchObject({
      success: true,
      eventId: "event-1",
      requestId: "publish-1",
    });
  });

  it("rejects waitForPublishedAck on timeout", async () => {
    const transport = new MockWaitTransport();
    const ackPromise = waitForPublishedAck({
      transport,
      requestId: "publish-timeout",
      timeoutMs: 40,
    });
    const rejection = expect(ackPromise).rejects.toBeInstanceOf(PlugTimeoutError);

    await vi.advanceTimersByTimeAsync(50);
    await rejection;
  });
});
