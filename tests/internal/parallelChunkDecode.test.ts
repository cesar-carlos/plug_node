import { describe, expect, it, vi } from "vitest";

import { createParallelChunkDecodeQueue } from "../../shared/socket/parallelChunkDecode";
import { createStreamAggregationController } from "../../shared/socket/streamAggregationState";
import {
  MAX_PARALLEL_CHUNK_DECODES,
  shouldPrefetchStreamPull,
} from "../../shared/socket/streamPullPrefetch";

describe("createParallelChunkDecodeQueue", () => {
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

    expect(onError).toHaveBeenCalled();
    expect(String(onError.mock.calls[0]?.[0])).toMatch(/cancelled/i);
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
