import { PlugError } from "../contracts/errors";

export interface RetryAfterInput {
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
}

export const normalizeRetryAfterSeconds = (
  input: RetryAfterInput,
): number | undefined => {
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

export interface SocketControlErrorInput extends RetryAfterInput {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly details?: Record<string, unknown>;
}

export interface SocketControlErrorOptions {
  readonly defaultCode: string;
  readonly defaultMessage: string;
  readonly includeTooManyRequestsAlias?: boolean;
  readonly notFound?: {
    readonly message: string;
    readonly description: string;
  };
}

export const createSocketControlError = (
  input: SocketControlErrorInput,
  options: SocketControlErrorOptions,
): PlugError => {
  const code =
    typeof input.code === "string" && input.code.trim() !== ""
      ? input.code
      : options.defaultCode;

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

  const isRateLimited =
    code === "RATE_LIMITED" ||
    input.statusCode === 429 ||
    (options.includeTooManyRequestsAlias === true && code === "TOO_MANY_REQUESTS");

  if (isRateLimited) {
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

  if (options.notFound !== undefined && input.statusCode === 404) {
    return new PlugError(options.notFound.message, {
      code,
      statusCode: input.statusCode,
      description: options.notFound.description,
      details: input.details,
      technicalMessage: input.message,
    });
  }

  return new PlugError(input.message ?? options.defaultMessage, {
    code,
    statusCode: input.statusCode,
    details: input.details,
  });
};
