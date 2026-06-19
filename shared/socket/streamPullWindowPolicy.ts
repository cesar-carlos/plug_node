import { DEFAULT_RELAY_PULL_WINDOW } from "../contracts/api";
import { isRecord } from "../utils/json";
import { relayMaxStreamPullWindowSize } from "./relaySessionConstants";

const streamPullHintKeys = [
  "recommendedStreamPullWindowSize",
  "recommended_stream_pull_window_size",
  "streamPullWindowSize",
  "stream_pull_window_size",
] as const;

const maxStreamPullHintKeys = [
  "maxStreamPullWindowSize",
  "max_stream_pull_window_size",
] as const;

const pickPositiveInteger = (
  source: Record<string, unknown> | null,
  keys: readonly string[],
): number | undefined => {
  if (!source) {
    return undefined;
  }

  for (const key of keys) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      return Math.floor(value);
    }
  }

  return undefined;
};

export const clampStreamPullWindowSize = (
  value: number,
  maxWindowSize = relayMaxStreamPullWindowSize,
): number => Math.min(maxWindowSize, Math.max(1, Math.floor(value)));

export const extractRecommendedStreamPullWindowSize = (
  payload: unknown,
): number | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const direct = pickPositiveInteger(payload, [...streamPullHintKeys]);
  if (direct !== undefined) {
    return clampStreamPullWindowSize(direct);
  }

  const nestedSources = [
    isRecord(payload.extensions) ? payload.extensions : null,
    isRecord(payload.limits) ? payload.limits : null,
    isRecord(payload.result) ? payload.result : null,
    isRecord(payload.capabilities) ? payload.capabilities : null,
    isRecord(payload.agent) ? payload.agent : null,
  ];

  for (const source of nestedSources) {
    const fromSource = pickPositiveInteger(source, [...streamPullHintKeys]);
    if (fromSource !== undefined) {
      return clampStreamPullWindowSize(fromSource);
    }

    if (source) {
      const fromExtensions = pickPositiveInteger(
        isRecord(source.extensions) ? source.extensions : null,
        [...streamPullHintKeys],
      );
      if (fromExtensions !== undefined) {
        return clampStreamPullWindowSize(fromExtensions);
      }

      const fromLimits = pickPositiveInteger(
        isRecord(source.limits) ? source.limits : null,
        [...streamPullHintKeys],
      );
      if (fromLimits !== undefined) {
        return clampStreamPullWindowSize(fromLimits);
      }
    }
  }

  return undefined;
};

export const extractMaxStreamPullWindowSize = (payload: unknown): number | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const nestedSources = [
    payload,
    isRecord(payload.extensions) ? payload.extensions : null,
    isRecord(payload.limits) ? payload.limits : null,
    isRecord(payload.result) ? payload.result : null,
    isRecord(payload.capabilities) ? payload.capabilities : null,
  ];

  for (const source of nestedSources) {
    const maxWindow = pickPositiveInteger(source, [...maxStreamPullHintKeys]);
    if (maxWindow !== undefined) {
      return clampStreamPullWindowSize(maxWindow);
    }
  }

  return undefined;
};

export const resolveAdaptiveStreamPullWindowSize = (input: {
  readonly configured?: number;
  readonly agentRecommended?: number;
  readonly agentMax?: number;
  readonly fallback?: number;
}): number => {
  const fallback = input.fallback ?? DEFAULT_RELAY_PULL_WINDOW;
  const hubMax = relayMaxStreamPullWindowSize;
  const agentMax = input.agentMax
    ? clampStreamPullWindowSize(input.agentMax, hubMax)
    : hubMax;
  const preferred = input.configured ?? input.agentRecommended ?? fallback;
  const ceiling =
    input.agentRecommended !== undefined
      ? clampStreamPullWindowSize(input.agentRecommended, Math.min(agentMax, hubMax))
      : Math.min(agentMax, hubMax);

  return clampStreamPullWindowSize(preferred, ceiling);
};
