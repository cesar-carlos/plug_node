import { describe, expect, it } from "vitest";

import {
  beginStreamPull,
  createStreamAggregationController,
  finishStreamPull,
  shouldSkipStreamPull,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/streamAggregationState";

describe("streamAggregationState", () => {
  it("tracks pull credits and schedules another pull when credits are exhausted", () => {
    const controller = createStreamAggregationController();
    controller.setActiveStreamId("stream-1");

    beginStreamPull(controller.state);
    controller.state.pendingChunksDuringPull = 2;
    const shouldPullAgain = finishStreamPull(controller.state, 2);
    controller.state.streamPullInFlight = false;

    expect(shouldPullAgain).toBe(true);
    expect(controller.state.pullCount).toBe(1);
    expect(shouldSkipStreamPull(controller.state)).toBe(false);
  });

  it("consumes chunk credits and schedules pull work when credits reach zero", async () => {
    const controller = createStreamAggregationController();
    controller.setActiveStreamId("stream-1");
    controller.state.streamCreditsRemaining = 1;

    controller.recordChunkReceived();
    expect(controller.state.streamCreditsRemaining).toBe(0);

    const scheduled: Array<() => Promise<void>> = [];
    controller.schedulePullIfCreditsExhausted(
      (work) => {
        scheduled.push(work);
      },
      async () => undefined,
    );

    expect(scheduled).toHaveLength(1);
    await scheduled[0]?.();
  });
});
