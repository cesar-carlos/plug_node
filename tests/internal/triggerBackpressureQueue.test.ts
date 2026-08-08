import { describe, expect, it, vi } from "vitest";

import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import { createBackpressureQueue } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseSocketEventTrigger/triggerBackpressureQueue";

describe("triggerBackpressureQueue", () => {
  it("reports dropNewest through onDrop and optional emitError", async () => {
    const emitError = vi.fn();
    const onDrop = vi.fn();
    let releaseBlocker: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 0,
      overflowPolicy: "dropNewest",
      emitError,
      onDrop,
      reportDropAsError: true,
    });

    queue.enqueue(() => blocker);
    queue.enqueue(async () => undefined);

    await vi.waitFor(() => {
      expect(onDrop).toHaveBeenCalledWith("dropNewest", { queueSize: 0 });
    });

    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SOCKET_EVENT_BACKPRESSURE_DROPPED",
      }),
    );
    expect(emitError.mock.calls[0]?.[0]).toBeInstanceOf(PlugError);

    releaseBlocker?.();
    queue.close();
  });

  it("does not grow the queue when dropOldest and maxQueueSize is 0", async () => {
    const onDrop = vi.fn();
    let releaseBlocker: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 0,
      overflowPolicy: "dropOldest",
      emitError: vi.fn(),
      onDrop,
    });

    queue.enqueue(() => blocker);
    queue.enqueue(async () => undefined);
    queue.enqueue(async () => undefined);

    expect(queue.getStats().queuedCount).toBe(0);
    expect(onDrop).toHaveBeenCalledWith("dropOldest", { queueSize: 0 });
    expect(queue.getStats().droppedOldestCount).toBe(2);

    releaseBlocker?.();
    queue.close();
  });

  it("emits SOCKET_EVENT_BACKPRESSURE_LIMIT when overflowPolicy is fail", async () => {
    const emitError = vi.fn();
    let releaseBlocker: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 0,
      overflowPolicy: "fail",
      emitError,
    });

    queue.enqueue(() => blocker);
    queue.enqueue(async () => undefined);

    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SOCKET_EVENT_BACKPRESSURE_LIMIT",
      }),
    );
    expect(queue.getStats().queuedCount).toBe(0);

    releaseBlocker?.();
    queue.close();
  });

  it("dropOldest with maxQueueSize > 0 shifts the oldest queued task", async () => {
    const onDrop = vi.fn();
    const processed: string[] = [];
    let releaseBlocker: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 1,
      overflowPolicy: "dropOldest",
      emitError: vi.fn(),
      onDrop,
    });

    queue.enqueue(() => blocker);
    queue.enqueue(async () => {
      processed.push("oldest");
    });
    queue.enqueue(async () => {
      processed.push("newest");
    });

    expect(onDrop).toHaveBeenCalledWith("dropOldest", { queueSize: 0 });
    expect(queue.getStats().droppedOldestCount).toBe(1);
    expect(queue.getStats().queuedCount).toBe(1);

    releaseBlocker?.();
    await vi.waitFor(() => {
      expect(processed).toEqual(["newest"]);
    });
    queue.close();
  });

  it("dropNewest with maxQueueSize > 0 discards the incoming task", async () => {
    const onDrop = vi.fn();
    const processed: string[] = [];
    let releaseBlocker: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 1,
      overflowPolicy: "dropNewest",
      emitError: vi.fn(),
      onDrop,
      reportDropAsError: true,
    });

    queue.enqueue(() => blocker);
    queue.enqueue(async () => {
      processed.push("queued");
    });
    queue.enqueue(async () => {
      processed.push("dropped");
    });

    expect(onDrop).toHaveBeenCalledWith("dropNewest", { queueSize: 1 });
    expect(queue.getStats().droppedNewestCount).toBe(1);
    expect(queue.getStats().queuedCount).toBe(1);

    releaseBlocker?.();
    await vi.waitFor(() => {
      expect(processed).toEqual(["queued"]);
    });
    queue.close();
  });

  it("fail with maxQueueSize > 0 emits SOCKET_EVENT_BACKPRESSURE_LIMIT", async () => {
    const emitError = vi.fn();
    let releaseBlocker: (() => void) | undefined;
    const blocker = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });

    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 1,
      overflowPolicy: "fail",
      emitError,
    });

    queue.enqueue(() => blocker);
    queue.enqueue(async () => undefined);
    queue.enqueue(async () => undefined);

    expect(emitError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "SOCKET_EVENT_BACKPRESSURE_LIMIT",
      }),
    );
    expect(queue.getStats().queuedCount).toBe(1);

    releaseBlocker?.();
    queue.close();
  });

  it("wraps non-PlugError task failures as SOCKET_EVENT_EMIT_FAILED", async () => {
    const emitError = vi.fn();
    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 1,
      overflowPolicy: "fail",
      emitError,
    });

    queue.enqueue(async () => {
      throw new Error("boom");
    });

    await vi.waitFor(() => {
      expect(emitError).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "SOCKET_EVENT_EMIT_FAILED",
        }),
      );
    });
    expect(queue.getStats().failedCount).toBe(1);
    queue.close();
  });

  it("ignores enqueue after close", async () => {
    const emitError = vi.fn();
    const queue = createBackpressureQueue({
      maxInflightEvents: 1,
      maxQueueSize: 2,
      overflowPolicy: "fail",
      emitError,
    });

    queue.close();
    queue.enqueue(async () => undefined);

    expect(queue.getStats().queuedCount).toBe(0);
    expect(queue.getStats().startedCount).toBe(0);
    expect(emitError).not.toHaveBeenCalled();
  });
});
