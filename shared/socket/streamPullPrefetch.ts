import type { StreamAggregationState } from "./streamAggregationState";

export const STREAM_PULL_PREFETCH_CREDIT_RATIO = 0.25;
/** Bounded overlapping PayloadFrame decodes before ordered merge. */
export const MAX_PARALLEL_CHUNK_DECODES = 4;

export const shouldPrefetchStreamPull = (
  state: StreamAggregationState,
  lastGrantedWindowSize: number,
): boolean => {
  if (
    !state.activeStreamId ||
    state.streamPullInFlight ||
    state.streamCompleted ||
    lastGrantedWindowSize <= 0
  ) {
    return false;
  }

  const prefetchThreshold = Math.max(
    1,
    Math.floor(lastGrantedWindowSize * STREAM_PULL_PREFETCH_CREDIT_RATIO),
  );
  return state.streamCreditsRemaining <= prefetchThreshold;
};
