import { getInfrastructureSkipReason } from "./environmentSkips";

export type StressOutcomeKind = "success" | "rate_limited" | "infrastructure" | "failure";

export interface StressAttemptOutcome {
  readonly kind: StressOutcomeKind;
  readonly durationMs: number;
  readonly detail?: string;
}

export interface StressRunSummary {
  readonly total: number;
  readonly successes: number;
  readonly rateLimited: number;
  readonly infrastructure: number;
  readonly failures: number;
  readonly elapsedMs: number;
  readonly maxDurationMs: number;
}

const collectErrorText = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const parts = [error.message];
  if (error.cause instanceof Error) {
    parts.push(error.cause.message);
  }

  return parts.join(" ");
};

export const classifyStressError = (error: unknown): StressOutcomeKind => {
  const infrastructureReason = getInfrastructureSkipReason(error);
  if (infrastructureReason) {
    return "infrastructure";
  }

  const text = collectErrorText(error);
  if (
    /rate limit/i.test(text) ||
    /RATE_LIMITED/i.test(text) ||
    /TOO_MANY_REQUESTS/i.test(text) ||
    /-32013/.test(text)
  ) {
    return "rate_limited";
  }

  return "failure";
};

export const summarizeStressOutcomes = (
  outcomes: readonly StressAttemptOutcome[],
  elapsedMs: number,
): StressRunSummary => {
  let successes = 0;
  let rateLimited = 0;
  let infrastructure = 0;
  let failures = 0;
  let maxDurationMs = 0;

  for (const outcome of outcomes) {
    maxDurationMs = Math.max(maxDurationMs, outcome.durationMs);
    switch (outcome.kind) {
      case "success":
        successes += 1;
        break;
      case "rate_limited":
        rateLimited += 1;
        break;
      case "infrastructure":
        infrastructure += 1;
        break;
      case "failure":
        failures += 1;
        break;
      default:
        break;
    }
  }

  return {
    total: outcomes.length,
    successes,
    rateLimited,
    infrastructure,
    failures,
    elapsedMs,
    maxDurationMs,
  };
};

export const runWithConcurrency = async <T>(
  total: number,
  concurrency: number,
  worker: (index: number) => Promise<T>,
): Promise<T[]> => {
  if (total <= 0) {
    return [];
  }

  const results = new Array<T>(total);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(concurrency, total) },
    async (): Promise<void> => {
      while (true) {
        const index = nextIndex;
        nextIndex += 1;
        if (index >= total) {
          return;
        }

        results[index] = await worker(index);
      }
    },
  );

  await Promise.all(runners);
  return results;
};
