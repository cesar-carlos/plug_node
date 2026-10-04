import { describe, expect, it, vi } from "vitest";

import { createParallelChunkDecodeQueue } from "../../shared/socket/parallelChunkDecode";
import { createStreamAggregationController } from "../../shared/socket/streamAggregationState";
import {
  MAX_PARALLEL_CHUNK_DECODES,
  shouldPrefetchStreamPull,
} from "../../shared/socket/streamPullPrefetch";

describe("createParallelChunkDecodeQueue", () => {
  it("should ignore a late rejection from a cancelled application and continue the next owner", async () => {
    const abort = new AbortController();
    const onError = vi.fn();
    let rejectApply!: (error: Error) => void;
    const applyGate = new Promise<void>((_, reject) => {
      rejectApply = reject;
    });
    const queue = createParallelChunkDecodeQueue({ onError });
    const applying = vi.fn(() => applyGate);
    queue.enqueueDecodeThenOrdered(async () => 1, applying, 10, abort.signal);
    await vi.waitFor(() => expect(applying).toHaveBeenCalled());
    abort.abort();
    const next = vi.fn();
    queue.enqueueDecodeThenOrdered(async () => 2, next, 10);
    rejectApply(new Error("old application failed"));
    await queue.drainOrderedWork();
    expect(onError).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledWith(2);
    expect(queue.metrics.pendingBytes).toBe(0);
  });

  it("should release reservations immediately and prevent late application on abort", async () => {
    const abort = new AbortController();
    const apply = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = createParallelChunkDecodeQueue({ signal: abort.signal });
    queue.enqueueDecodeThenOrdered(
      async () => {
        await gate;
        return 1;
      },
      apply,
      128,
    );
    expect(queue.metrics.pendingBytes).toBe(128);
    abort.abort();
    expect(queue.metrics.pendingBytes).toBe(0);
    await queue.drainOrderedWork();
    release();
    await Promise.resolve();
    expect(apply).not.toHaveBeenCalled();
  });

  it("should count results waiting for application against frame and byte limits", async () => {
    const onError = vi.fn();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const queue = createParallelChunkDecodeQueue({
      maxPendingFrames: 2,
      maxPendingBytes: 100,
      onError,
    });
    queue.enqueueOrderedWork(async () => gate);
    queue.enqueueDecodeThenOrdered(
      async () => 1,
      () => undefined,
      60,
    );
    await Promise.resolve();
    queue.enqueueDecodeThenOrdered(
      async () => 2,
      () => undefined,
      60,
    );
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "SOCKET_BUFFER_LIMIT" }),
    );
    release();
    await queue.drainOrderedWork();
    expect(queue.metrics.pendingFrames).toBe(0);
  });

  it.each([0, -1, NaN, Infinity, 9])(
    "should reject invalid decode parallelism %s",
    (maxParallel) => {
      expect(() => createParallelChunkDecodeQueue({ maxParallel })).toThrow();
    },
  );

  it("overlaps decode work while applying results in order", async () => {
    const applyOrder: number[] = [];
    const decodeStarts: number[] = [];
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const queue = createParallelChunkDecodeQueue({ maxParallel: 2 });

    queue.enqueueDecodeThenOrdered(
      async () => {
        decodeStarts.push(1);
        await new Promise((resolve) => setTimeout(resolve, 20));
        return 1;
      },
      (value) => {
        applyOrder.push(value);
      },
    );

    queue.enqueueDecodeThenOrdered(
      async () => {
        decodeStarts.push(2);
        await secondGate;
        return 2;
      },
      (value) => {
        applyOrder.push(value);
      },
    );

    queue.enqueueDecodeThenOrdered(
      async () => {
        decodeStarts.push(3);
        return 3;
      },
      (value) => {
        applyOrder.push(value);
      },
    );

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(decodeStarts).toEqual([1, 2]);

    releaseSecond();
    await queue.drainOrderedWork();

    expect(applyOrder).toEqual([1, 2, 3]);
    expect(decodeStarts).toEqual([1, 2, 3]);
  });

  it("caps in-flight decodes at MAX_PARALLEL_CHUNK_DECODES by default", async () => {
    expect(MAX_PARALLEL_CHUNK_DECODES).toBe(8);

    let inflight = 0;
    let peakInflight = 0;
    const releaseGates: Array<() => void> = [];
    const queue = createParallelChunkDecodeQueue();
    const total = MAX_PARALLEL_CHUNK_DECODES + 4;

    for (let index = 0; index < total; index += 1) {
      const gate = new Promise<void>((resolve) => {
        releaseGates.push(resolve);
      });
      queue.enqueueDecodeThenOrdered(
        async () => {
          inflight += 1;
          peakInflight = Math.max(peakInflight, inflight);
          await gate;
          inflight -= 1;
          return index;
        },
        () => undefined,
      );
    }

    await vi.waitFor(() => {
      expect(peakInflight).toBe(MAX_PARALLEL_CHUNK_DECODES);
    });

    for (const release of releaseGates) {
      release();
    }
    await queue.drainOrderedWork();

    expect(peakInflight).toBe(MAX_PARALLEL_CHUNK_DECODES);
    expect(inflight).toBe(0);
  });

  it("forwards ordered-work errors to onError", async () => {
    const onError = vi.fn();
    const queue = createParallelChunkDecodeQueue({ onError });

    queue.enqueueOrderedWork(async () => {
      throw new Error("ordered-failure");
    });

    await queue.drainOrderedWork();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ message: "ordered-failure" });
  });

  it("rejects orphaned pending decodes so drainOrderedWork does not hang", async () => {
    const onError = vi.fn();
    const queue = createParallelChunkDecodeQueue({ maxParallel: 1, onError });
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    queue.enqueueDecodeThenOrdered(
      async () => {
        await firstGate;
        return 1;
      },
      () => undefined,
    );
    queue.enqueueDecodeThenOrdered(
      async () => 2,
      () => undefined,
    );

    queue.clearPendingDecodes();
    releaseFirst();

    await Promise.race([
      queue.drainOrderedWork(),
      new Promise((_, reject) => {
        setTimeout(() => reject(new Error("drain hung")), 500);
      }),
    ]);

    expect(onError).not.toHaveBeenCalled();
    expect(queue.metrics.pendingFrames).toBe(0);
    expect(queue.metrics.pendingBytes).toBe(0);
  });
});

describe("shouldPrefetchStreamPull", () => {
  it("matches stream aggregation prefetch scheduling", () => {
    const controller = createStreamAggregationController();
    controller.setActiveStreamId("stream-1");
    controller.state.lastGrantedWindowSize = 100;
    controller.state.streamCreditsRemaining = 25;

    expect(shouldPrefetchStreamPull(controller.state, 100)).toBe(true);

    const pulls: number[] = [];
    controller.schedulePullIfCreditsExhausted(
      (work) => {
        void work();
      },
      async () => {
        pulls.push(1);
      },
    );

    expect(pulls).toEqual([1]);
  });
});
