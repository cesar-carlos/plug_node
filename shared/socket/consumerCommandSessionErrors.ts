import { PlugError } from "../contracts/errors";
import { createSocketApplicationError, createSocketConnectError } from "./socketErrors";

export const createConsumerConnectError = (payload: unknown): PlugError =>
  createSocketConnectError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
    retryDescription: "Run the node again to create a fresh socket connection.",
  });

export const createConsumerSocketAppError = (payload: unknown): PlugError =>
  createSocketApplicationError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
  });

export const createConsumerDisconnectError = (reason: unknown): PlugError =>
  new PlugError("The Plug socket disconnected before the command finished.", {
    code: "SOCKET_DISCONNECTED",
    description: "Run the node again to open a new socket connection.",
    technicalMessage: typeof reason === "string" ? reason : undefined,
    retryable: true,
  });

const normalizeRetryAfterSeconds = (input: {
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
}): number | undefined => {
  if (
    typeof input.retryAfterSeconds === "number" &&
    Number.isFinite(input.retryAfterSeconds) &&
    input.retryAfterSeconds > 0
  ) {
    return Math.max(1, Math.ceil(input.retryAfterSeconds));
  }

  if (
    typeof input.retryAfterMs === "number" &&
    Number.isFinite(input.retryAfterMs) &&
    input.retryAfterMs > 0
  ) {
    return Math.max(1, Math.ceil(input.retryAfterMs / 1000));
  }

  return undefined;
};

export const createConsumerControlError = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;
}): PlugError => {
  const code =
    typeof input.code === "string" && input.code.trim() !== ""
      ? input.code
      : "SOCKET_COMMAND_ERROR";

  if (code === "VALIDATION_ERROR" || input.statusCode === 400) {
    return new PlugError("Plug rejected the socket request payload.", {
      code,
      statusCode: input.statusCode,
      description: "Review the node fields and any advanced JSON before trying again.",
      details: input.details,
      technicalMessage: input.message,
    });
  }

  const retryAfterSeconds = normalizeRetryAfterSeconds(input);

  if (
    code === "RATE_LIMITED" ||
    code === "TOO_MANY_REQUESTS" ||
    input.statusCode === 429
  ) {
    return new PlugError("Plug rate limited the socket request.", {
      code,
      statusCode: input.statusCode,
      description:
        retryAfterSeconds !== undefined
          ? `Wait ${retryAfterSeconds} second(s) before trying this socket operation again.`
          : "Wait a moment before trying this socket operation again.",
      details: input.details,
      technicalMessage: input.message,
      retryable: true,
      retryAfterSeconds,
    });
  }

  if (input.statusCode === 503 || code === "SERVICE_UNAVAILABLE") {
    return new PlugError("Plug socket transport is temporarily unavailable.", {
      code,
      statusCode: input.statusCode,
      description:
        retryAfterSeconds !== undefined
          ? `The hub or agent may be overloaded. Try again in ${retryAfterSeconds} second(s).`
          : "The hub or agent may be overloaded. Try again shortly.",
      details: input.details,
      technicalMessage: input.message,
      retryable: true,
      retryAfterSeconds,
    });
  }

  if (input.statusCode === 404) {
    return new PlugError("The requested stream or agent route was not found.", {
      code,
      statusCode: input.statusCode,
      description: "Run the command again and confirm that the agent is still connected.",
      details: input.details,
      technicalMessage: input.message,
    });
  }

  return new PlugError(input.message ?? "Socket command request failed.", {
    code,
    statusCode: input.statusCode,
    details: input.details,
  });
};
