import { describe, expect, it, vi } from "vitest";

import { createParallelChunkDecodeQueue } from "../../shared/socket/parallelChunkDecode";
import { createStreamAggregationController } from "../../shared/socket/streamAggregationState";
import { shouldPrefetchStreamPull } from "../../shared/socket/streamPullPrefetch";

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
