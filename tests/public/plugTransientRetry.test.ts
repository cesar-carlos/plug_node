import { describe, expect, it, vi } from "vitest";

import { PlugError, PlugValidationError } from "../../shared/contracts/errors";
import {
  computeRetryDelayMs,
  getPlugOperationRetryKind,
  MAX_TRANSIENT_RETRIES,
  shouldRetryPlugOperation,
  sleepMs,
} from "../../shared/n8n/plugTransientRetry";

describe("plugTransientRetry", () => {
  it("classifies sql and metadata operations", () => {
    expect(getPlugOperationRetryKind("executeSql")).toBe("sql");
    expect(getPlugOperationRetryKind("validateContext")).toBe("metadata");
    expect(getPlugOperationRetryKind("notAnOperation" as "executeSql")).toBeUndefined();
  });

  it("retries rate-limited REST errors for executeSql", () => {
    const error = new PlugError("rate limited", {
      code: "RATE_LIMITED",
      statusCode: 429,
      retryable: true,
      retryAfterSeconds: 2,
    });

    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error,
        attemptNumber: 0,
      }),
    ).toBe(true);
    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error,
        attemptNumber: MAX_TRANSIENT_RETRIES,
      }),
    ).toBe(false);
  });

  it("does not retry replay_detected", () => {
    const error = new PlugError("replay", {
      code: "RPC_-32014",
      retryable: false,
      details: { reason: "replay_detected" },
    });

    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error,
        attemptNumber: 0,
      }),
    ).toBe(false);
  });

  it("does not retry validation errors", () => {
    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error: new PlugValidationError("bad sql"),
        attemptNumber: 0,
      }),
    ).toBe(false);
  });

  it("uses retryAfterSeconds for delay when present", () => {
    const error = new PlugError("rate limited", {
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 3,
    });

    expect(computeRetryDelayMs(error, 0)).toBe(3000);
    expect(computeRetryDelayMs(error, 1)).toBe(3000);
  });

  it("applies exponential backoff when retryAfterSeconds is absent", () => {
    const error = new PlugError("unavailable", {
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      retryable: true,
    });

    expect(computeRetryDelayMs(error, 0)).toBe(250);
    expect(computeRetryDelayMs(error, 1)).toBe(500);
  });

  it("sleepMs resolves after the requested delay", async () => {
    vi.useFakeTimers();
    const promise = sleepMs(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
