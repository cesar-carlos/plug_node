import type { PlugOperation } from "../contracts/api";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";

/** Number of retries after the first attempt (3 executions total). */
export const MAX_TRANSIENT_RETRIES = 2;

const sqlOperations = new Set<PlugOperation>([
  "executeSql",
  "executeBatch",
  "bulkInsertSql",
  "cancelSql",
]);

const metadataOperations = new Set<PlugOperation>([
  "validateContext",
  "discoverRpc",
  "getAgentProfile",
  "getClientTokenPolicy",
]);

export type PlugOperationRetryKind = "sql" | "metadata";

export const getPlugOperationRetryKind = (
  operation: PlugOperation,
): PlugOperationRetryKind | undefined => {
  if (sqlOperations.has(operation)) {
    return "sql";
  }

  if (metadataOperations.has(operation)) {
    return "metadata";
  }

  return undefined;
};

export const isReplayDetectedPlugError = (error: unknown): boolean => {
  if (!(error instanceof PlugError)) {
    return false;
  }

  return isReplayDetectedError(error);
};

const isReplayDetectedError = (error: PlugError): boolean => {
  if (error.code === "RPC_-32014") {
    return true;
  }

  const details = error.details;
  if (!isRecord(details)) {
    return false;
  }

  if (details.reason === "replay_detected") {
    return true;
  }

  const rpcError = details.rpcError;
  if (isRecord(rpcError) && rpcError.code === -32014) {
    return true;
  }

  return false;
};

const isMethodNotFoundError = (error: PlugError): boolean => {
  if (error.code === "RPC_-32601") {
    return true;
  }

  const details = error.details;
  if (!isRecord(details)) {
    return false;
  }

  return details.reason === "method_not_found";
};

export const applyRetryBackoffJitter = (baseDelayMs: number): number => {
  if (baseDelayMs <= 0) {
    return 0;
  }

  const jitterFactor = 0.75 + Math.random() * 0.5;
  return Math.max(0, Math.round(baseDelayMs * jitterFactor));
};

export const computeRetryDelayMs = (error: PlugError, attemptNumber: number): number => {
  if (
    typeof error.retryAfterSeconds === "number" &&
    Number.isFinite(error.retryAfterSeconds) &&
    error.retryAfterSeconds > 0
  ) {
    return Math.max(0, Math.ceil(error.retryAfterSeconds * 1000));
  }

  const baseDelayMs = Math.min(5000, 250 * 2 ** attemptNumber);
  return applyRetryBackoffJitter(baseDelayMs);
};

/** Retries transient REST failures using the same policy as metadata hub calls. */
export const executeWithPlugTransientRetry = async <T>(input: {
  readonly execute: () => Promise<T>;
  readonly attemptNumberOffset?: number;
}): Promise<{
  readonly value: T;
  readonly attemptCount: number;
  readonly lastRetryDelayMs?: number;
}> => {
  let lastRetryDelayMs: number | undefined;
  const attemptNumberOffset = input.attemptNumberOffset ?? 0;

  for (
    let attemptNumber = 0;
    attemptNumber <= MAX_TRANSIENT_RETRIES;
    attemptNumber += 1
  ) {
    try {
      return {
        value: await input.execute(),
        attemptCount: attemptNumber + 1 + attemptNumberOffset,
        lastRetryDelayMs,
      };
    } catch (error: unknown) {
      if (
        !shouldRetryPlugOperation({
          operation: "validateContext",
          error,
          attemptNumber,
        })
      ) {
        throw error;
      }

      const delayMs =
        error instanceof PlugError
          ? computeRetryDelayMs(error, attemptNumber)
          : computeRetryDelayMs(
              new PlugError("Plug request timed out before completion.", {
                code: "PLUG_TIMEOUT",
                retryable: true,
              }),
              attemptNumber,
            );
      lastRetryDelayMs = delayMs;
      await sleepMs(delayMs);
    }
  }

  throw new PlugValidationError("Plug request finished without a successful attempt");
};

export const sleepMs = async (ms: number): Promise<void> => {
  if (ms <= 0) {
    return;
  }

  await new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
};

export const shouldRetryPlugOperation = (input: {
  readonly operation: PlugOperation;
  readonly error: unknown;
  readonly attemptNumber: number;
}): boolean => {
  if (input.attemptNumber >= MAX_TRANSIENT_RETRIES) {
    return false;
  }

  if (getPlugOperationRetryKind(input.operation) === undefined) {
    return false;
  }

  if (input.error instanceof PlugValidationError) {
    return false;
  }

  if (input.error instanceof PlugTimeoutError) {
    return true;
  }

  if (!(input.error instanceof PlugError)) {
    return false;
  }

  if (input.error.authRelated) {
    return false;
  }

  if (isReplayDetectedError(input.error) || isMethodNotFoundError(input.error)) {
    return false;
  }

  return input.error.retryable;
};
