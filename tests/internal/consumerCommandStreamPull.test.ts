import { describe, expect, it } from "vitest";

import { PlugTimeoutError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import type { ConsumerSocketTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandSessionTypes";
import {
  matchesConsumerCommandRequest,
  matchesConsumerStreamPayload,
  matchesConsumerStreamPullResponse,
  normalizeConsumerStreamPullWindowSize,
  requestConsumerStreamPull,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandStreamPull";
import { toConsumerCommandRequestId } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandWire";

class MockConsumerPullTransport implements ConsumerSocketTransport {
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

describe("matchesConsumerStreamPullResponse", () => {
  it("requires requestId and streamId on successful pull responses", () => {
    expect(
      matchesConsumerStreamPullResponse(
        {
          success: true,
          requestId: "req-1",
          streamId: "stream-1",
          windowSize: 8,
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(true);

    expect(
      matchesConsumerStreamPullResponse(
        {
          success: true,
          requestId: "other",
          streamId: "stream-1",
          windowSize: 8,
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(false);
  });

  it("accepts uncorrelated failure payloads for fail-fast handling on the active pull", () => {
    expect(
      matchesConsumerStreamPullResponse(
        {
          success: false,
          error: {
            code: "STREAM_LOST",
            message: "Stream was lost",
          },
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(true);
  });

  it("rejects failures that target a different requestId or streamId", () => {
    expect(
      matchesConsumerStreamPullResponse(
        {
          success: false,
          requestId: "other",
          error: { code: "X", message: "nope" },
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(false);

    expect(
      matchesConsumerStreamPullResponse(
        {
          success: false,
          streamId: "other-stream",
          error: { code: "X", message: "nope" },
        },
        "req-1",
        "stream-1",
      ),
    ).toBe(false);
  });
});

describe("consumer stream pull helpers", () => {
  it("normalizes and clamps pull window sizes", () => {
    expect(normalizeConsumerStreamPullWindowSize(undefined, 16)).toBe(16);
    expect(normalizeConsumerStreamPullWindowSize(0, 16)).toBe(16);
    expect(normalizeConsumerStreamPullWindowSize(8.9, 16)).toBe(8);
    expect(normalizeConsumerStreamPullWindowSize(50_000, 16)).toBeLessThanOrEqual(1000);
  });

  it("matches command request ids and stream payloads", () => {
    expect(matchesConsumerCommandRequest({ requestId: "req-1" }, "req-1")).toBe(true);
    expect(
      matchesConsumerCommandRequest({ clientRequestId: "client-1" }, "client-1"),
    ).toBe(true);
    expect(matchesConsumerCommandRequest({ requestId: "other" }, "req-1")).toBe(false);

    expect(
      matchesConsumerStreamPayload(
        { request_id: "req-1", stream_id: "stream-1" },
        "req-1",
        "command-1",
        undefined,
        toConsumerCommandRequestId,
      ),
    ).toBe(false);

    expect(
      matchesConsumerStreamPayload(
        { request_id: "req-1", stream_id: "stream-1" },
        "req-1",
        "command-1",
        "stream-1",
        toConsumerCommandRequestId,
      ),
    ).toBe(true);
  });
});

describe("requestConsumerStreamPull", () => {
  it("resolves successful pull responses and times out otherwise", async () => {
    const transport = new MockConsumerPullTransport();
    const pullPromise = requestConsumerStreamPull(
      transport,
      "req-1",
      "stream-1",
      1_000,
      16,
    );

    expect(
      transport.emittedEvents.some((entry) => entry.event === "agents:stream_pull"),
    ).toBe(true);

    transport.dispatch("agents:stream_pull_response", {
      success: true,
      requestId: "req-1",
      streamId: "stream-1",
      windowSize: 24,
    });

    await expect(pullPromise).resolves.toBe(24);

    await expect(
      requestConsumerStreamPull(
        transport,
        "req-2",
        "stream-2",
        20,
        8,
        undefined,
        undefined,
        {
          attachTerminalListeners: false,
        },
      ),
    ).rejects.toBeInstanceOf(PlugTimeoutError);
  });

  it("rejects on terminal disconnect while a pull is in flight", async () => {
    const transport = new MockConsumerPullTransport();
    const pullPromise = requestConsumerStreamPull(
      transport,
      "req-1",
      "stream-1",
      5_000,
      8,
    );

    expect(transport.listenerCount("disconnect")).toBe(1);
    transport.dispatch("disconnect", "io server disconnect");

    await expect(pullPromise).rejects.toBeTruthy();
  });

  it("invokes onIgnoredResponse for uncorrelated success payloads", async () => {
    const transport = new MockConsumerPullTransport();
    const ignored: unknown[] = [];
    const pullPromise = requestConsumerStreamPull(
      transport,
      "req-1",
      "stream-1",
      5_000,
      8,
      (payload) => {
        ignored.push(payload);
      },
    );

    transport.dispatch("agents:stream_pull_response", {
      success: true,
      requestId: "other",
      streamId: "stream-1",
      windowSize: 8,
    });

    await expect(
      Promise.race([
        pullPromise.then(() => "resolved"),
        new Promise((resolve) => setTimeout(() => resolve("pending"), 30)),
      ]),
    ).resolves.toBe("pending");
    expect(ignored).toHaveLength(1);

    transport.dispatch("agents:stream_pull_response", {
      success: true,
      requestId: "req-1",
      streamId: "stream-1",
      windowSize: 8,
    });
    await expect(pullPromise).resolves.toBe(8);
  });
});
