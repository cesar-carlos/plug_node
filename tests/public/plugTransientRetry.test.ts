import { describe, expect, it, vi } from "vitest";

import {
  PlugError,
  PlugTimeoutError,
  PlugValidationError,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  applyRetryBackoffJitter,
  computeRetryDelayMs,
  executeWithPlugTransientRetry,
  getPlugOperationRetryKind,
  isReplayDetectedPlugError,
  MAX_TRANSIENT_RETRIES,
  shouldRetryPlugOperation,
  sleepMs,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugTransientRetry";

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

  it("does not retry method_not_found errors", () => {
    const error = new PlugError("method missing", {
      code: "RPC_-32601",
      retryable: true,
      details: { reason: "method_not_found" },
    });

    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error,
        attemptNumber: 0,
      }),
    ).toBe(false);
  });

  it("does not retry auth-related errors", () => {
    const error = new PlugError("unauthorized", {
      code: "UNAUTHORIZED",
      retryable: true,
      authRelated: true,
    });

    expect(
      shouldRetryPlugOperation({
        operation: "getAgentProfile",
        error,
        attemptNumber: 0,
      }),
    ).toBe(false);
  });

  it("retries PlugTimeoutError for SQL operations", () => {
    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error: new PlugTimeoutError("timed out"),
        attemptNumber: 0,
      }),
    ).toBe(true);
    expect(
      shouldRetryPlugOperation({
        operation: "executeSql",
        error: new PlugTimeoutError("timed out"),
        attemptNumber: MAX_TRANSIENT_RETRIES,
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

  it("applies exponential backoff with jitter when retryAfterSeconds is absent", () => {
    const error = new PlugError("unavailable", {
      code: "SERVICE_UNAVAILABLE",
      statusCode: 503,
      retryable: true,
    });

    const randomSpy = vi.spyOn(Math, "random").mockReturnValue(0);
    expect(computeRetryDelayMs(error, 0)).toBe(188);
    expect(computeRetryDelayMs(error, 1)).toBe(375);
    randomSpy.mockRestore();
  });

  it("applies jitter within the expected backoff range", () => {
    expect(applyRetryBackoffJitter(250)).toBeGreaterThanOrEqual(188);
    expect(applyRetryBackoffJitter(250)).toBeLessThanOrEqual(313);
    expect(applyRetryBackoffJitter(500)).toBeGreaterThanOrEqual(375);
    expect(applyRetryBackoffJitter(500)).toBeLessThanOrEqual(625);
  });

  it("detects replay_detected errors", () => {
    const error = new PlugError("replay", {
      code: "RPC_-32014",
      details: { reason: "replay_detected" },
    });
    expect(isReplayDetectedPlugError(error)).toBe(true);
    expect(isReplayDetectedPlugError(new Error("other"))).toBe(false);
  });

  it("retries REST access calls with metadata policy", async () => {
    let attempts = 0;
    const { value, attemptCount } = await executeWithPlugTransientRetry({
      execute: async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new PlugError("unavailable", {
            code: "SERVICE_UNAVAILABLE",
            statusCode: 503,
            retryable: true,
          });
        }

        return "ok";
      },
    });

    expect(value).toBe("ok");
    expect(attemptCount).toBe(2);
  });

  it("sleepMs resolves after the requested delay", async () => {
    vi.useFakeTimers();
    const promise = sleepMs(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(promise).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});
