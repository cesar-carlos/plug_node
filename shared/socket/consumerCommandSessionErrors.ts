import { PlugError } from "../contracts/errors";
import { createSocketApplicationError, createSocketConnectError } from "./socketErrors";
import { createSocketControlError } from "./socketControlErrors";

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

export const createConsumerControlError = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;
}): PlugError =>
  createSocketControlError(input, {
    defaultCode: "SOCKET_COMMAND_ERROR",
    defaultMessage: "Socket command request failed.",
    includeTooManyRequestsAlias: true,
    notFound: {
      message: "The requested stream or agent route was not found.",
      description: "Run the command again and confirm that the agent is still connected.",
    },
  });
