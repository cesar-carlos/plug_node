export interface StreamAggregationState {
  activeStreamId?: string;
  streamCreditsRemaining: number;
  streamPullInFlight: boolean;
  pendingChunksDuringPull: number;
  streamCompleted: boolean;
  pullCount: number;
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
  };

  return {
    state,
    setActiveStreamId(streamId: string): void {
      state.activeStreamId = streamId;
    },
    recordChunkReceived(): void {
      if (state.activeStreamId && state.streamPullInFlight) {
        state.pendingChunksDuringPull += 1;
      } else if (state.activeStreamId && state.streamCreditsRemaining > 0) {
        state.streamCreditsRemaining -= 1;
      }
    },
    schedulePullIfCreditsExhausted(
      enqueueChunkWork: (work: () => Promise<void>) => void,
      requestNextStreamWindow: () => Promise<void>,
    ): void {
      if (state.activeStreamId && state.streamCreditsRemaining === 0) {
        enqueueChunkWork(async () => {
          if (!state.streamCompleted) {
            await requestNextStreamWindow();
          }
        });
      }
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

export const finishStreamPull = (
  state: StreamAggregationState,
  nextWindowSize: number,
): boolean => {
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
