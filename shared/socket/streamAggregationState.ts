export interface StreamAggregationState {
  activeStreamId?: string;
  streamCreditsRemaining: number;
  streamPullInFlight: boolean;
  pendingChunksDuringPull: number;
  streamCompleted: boolean;
  pullCount: number;
  lastGrantedWindowSize: number;
}

export interface StreamAggregationController {
  readonly state: StreamAggregationState;
  setActiveStreamId(streamId: string): void;
  recordChunkReceived(): void;
  schedulePullIfCreditsExhausted(
    enqueueChunkWork: (work: () => Promise<void>) => void,
    requestNextStreamWindow: () => Promise<void>,
  ): void;
  requestInitialWindow(requestNextStreamWindow: () => Promise<void>): Promise<void>;
}

export const createStreamAggregationController = (): StreamAggregationController => {
  const state: StreamAggregationState = {
    streamCreditsRemaining: 0,
    streamPullInFlight: false,
    pendingChunksDuringPull: 0,
    streamCompleted: false,
    pullCount: 0,
    lastGrantedWindowSize: 0,
  };

  return {
    state,
    setActiveStreamId(streamId: string): void {
      state.activeStreamId = streamId;
    },
    recordChunkReceived(): void {
      // Ignore credit accounting until the stream id is known; early chunks that
      // arrive before agents:command_response would otherwise skip the window.
      if (!state.activeStreamId) {
        return;
      }

      if (state.streamPullInFlight) {
        state.pendingChunksDuringPull += 1;
      } else if (state.streamCreditsRemaining > 0) {
        state.streamCreditsRemaining -= 1;
      }
    },
    schedulePullIfCreditsExhausted(
      enqueueChunkWork: (work: () => Promise<void>) => void,
      requestNextStreamWindow: () => Promise<void>,
    ): void {
      if (!state.activeStreamId || state.streamCompleted || state.streamPullInFlight) {
        return;
      }

      const prefetchThreshold = Math.max(
        1,
        Math.floor(state.lastGrantedWindowSize * 0.25),
      );
      const shouldPull =
        state.streamCreditsRemaining === 0 ||
        (state.lastGrantedWindowSize > 0 &&
          state.streamCreditsRemaining <= prefetchThreshold);

      if (!shouldPull) {
        return;
      }

      enqueueChunkWork(async () => {
        if (!state.streamCompleted) {
          await requestNextStreamWindow();
        }
      });
    },
    async requestInitialWindow(
      requestNextStreamWindow: () => Promise<void>,
    ): Promise<void> {
      await requestNextStreamWindow();
    },
  };
};

export const beginStreamPull = (state: StreamAggregationState): void => {
  state.streamPullInFlight = true;
  state.pullCount += 1;
};

export const abortStreamPull = (state: StreamAggregationState): void => {
  if (!state.streamPullInFlight) {
    return;
  }

  state.streamPullInFlight = false;
  state.pullCount = Math.max(0, state.pullCount - 1);
  // Keep pendingChunksDuringPull so a later successful pull still subtracts them.
};

export const finishStreamPull = (
  state: StreamAggregationState,
  nextWindowSize: number,
): boolean => {
  state.lastGrantedWindowSize = nextWindowSize;
  state.streamCreditsRemaining = Math.max(
    nextWindowSize - state.pendingChunksDuringPull,
    0,
  );
  state.pendingChunksDuringPull = 0;
  state.streamPullInFlight = false;

  return (
    state.activeStreamId !== undefined &&
    state.streamCreditsRemaining === 0 &&
    !state.streamCompleted
  );
};

export const shouldSkipStreamPull = (state: StreamAggregationState): boolean =>
  !state.activeStreamId || state.streamPullInFlight || state.streamCompleted;
