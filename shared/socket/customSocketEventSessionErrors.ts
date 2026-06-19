import { PlugError } from "../contracts/errors";
import { createSocketApplicationError, createSocketConnectError } from "./socketErrors";
import type {
  SocketEventControlAck,
  SocketEventPublishedAck,
} from "../contracts/custom-socket-events";
import { normalizeRetryAfterSeconds } from "./socketControlErrors";

export const createCustomSocketAppError = (payload: unknown): PlugError =>
  createSocketApplicationError(payload, {
    refreshDescription: "The workflow will refresh the Plug session and reconnect.",
    namespaceDeprecatedDescription:
      "Use the /consumers namespace for custom socket events.",
    retryableCodes: [
      "CONSUMER_SOCKET_INITIALIZATION_FAILED",
      "CONSUMER_IDLE_TIMEOUT",
      "ROOM_JOIN_FAILED",
      "SOCKET_APP_ERROR",
    ],
  });

export const createCustomSocketConnectError = (payload: unknown): PlugError =>
  createSocketConnectError(payload, {
    refreshDescription: "The workflow will refresh the Plug session and reconnect.",
    retryDescription: "Run the workflow again to create a fresh socket connection.",
  });

export const createCustomSocketDisconnectError = (reason: unknown): PlugError =>
  new PlugError("The Plug socket disconnected while listening for custom events.", {
    code: "SOCKET_DISCONNECTED",
    description: "The workflow will need to reconnect before receiving more events.",
    technicalMessage: typeof reason === "string" ? reason : undefined,
    retryable: true,
  });

const buildSocketAckError = (
  error: {
    readonly code: string;
    readonly message: string;
    readonly statusCode?: number;
    readonly retryAfterMs?: number;
  },
  rateLimit: unknown,
): PlugError => {
  const retryAfterSeconds = normalizeRetryAfterSeconds({
    retryAfterMs: error.retryAfterMs,
  });
  return new PlugError(error.message, {
    code: error.code,
    statusCode: error.statusCode,
    retryable: error.code === "RATE_LIMITED" || error.statusCode === 429,
    retryAfterSeconds,
    details: rateLimit ? { rateLimit } : undefined,
  });
};

export const createCustomSocketControlError = (
  ack: Extract<SocketEventControlAck, { success: false }>,
): PlugError => buildSocketAckError(ack.error, ack.rateLimit);

export const createCustomSocketPublishedError = (
  ack: Extract<SocketEventPublishedAck, { success: false }>,
): PlugError => buildSocketAckError(ack.error, ack.rateLimit);
