import { PlugError } from "../contracts/errors";
import { createSocketApplicationError, createSocketConnectError } from "./socketErrors";
import { createSocketControlError } from "./socketControlErrors";

const sharedSocketAppErrorRetryableCodes = [
  "CONSUMER_SOCKET_INITIALIZATION_FAILED",
  "CONSUMER_IDLE_TIMEOUT",
  "ROOM_JOIN_FAILED",
  "SOCKET_APP_ERROR",
] as const;

export const createRelaySocketAppError = (payload: unknown): PlugError =>
  createSocketApplicationError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
    namespaceDeprecatedDescription:
      "Use the /consumers namespace for Plug Database socket commands.",
    retryableCodes: sharedSocketAppErrorRetryableCodes,
  });

export const createRelayConnectError = (payload: unknown): PlugError =>
  createSocketConnectError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
    retryDescription: "Run the node again to create a fresh socket connection.",
  });

export const createRelayDisconnectError = (reason: unknown): PlugError =>
  new PlugError("The Plug socket disconnected before the relay command finished.", {
    code: "SOCKET_DISCONNECTED",
    description: "Run the node again to open a new socket connection.",
    technicalMessage: typeof reason === "string" ? reason : undefined,
    retryable: true,
  });

export const createRelayControlError = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;
}): PlugError =>
  createSocketControlError(input, {
    defaultCode: "RELAY_ERROR",
    defaultMessage: "Socket relay request failed.",
  });
