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

export const computeRetryDelayMs = (error: PlugError, attemptNumber: number): number => {
  if (
    typeof error.retryAfterSeconds === "number" &&
    Number.isFinite(error.retryAfterSeconds) &&
    error.retryAfterSeconds > 0
  ) {
    return Math.max(0, Math.ceil(error.retryAfterSeconds * 1000));
  }

  return Math.min(5000, 250 * 2 ** attemptNumber);
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
