import { PlugError } from "../contracts/errors";
import { isRecord } from "../utils/json";

const compactRecord = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );

const resolveReasonDescription = (error: PlugError): string | undefined => {
  if (error.description) {
    return error.description;
  }

  const details = error.details;
  if (!isRecord(details)) {
    return undefined;
  }

  const reason = details.reason;
  if (typeof reason !== "string") {
    return undefined;
  }

  switch (reason) {
    case "replay_detected":
      return "This command id was already used recently. Run the node again to send a new request.";
    case "agent_disconnected_at_dispatch":
    case "agent_offline":
      return "The agent is offline. Wait until it reconnects, then run the node again.";
    case "method_not_found":
      return "This Plug server does not support the requested operation. Check the node version and server capabilities.";
    case "rate_limited":
      return "Plug rate limited this request. Wait before trying again.";
    default:
      return undefined;
  }
};

/** Strips internal Plug fields before surfacing errors to n8n operators. */
export const toNodeFacingError = (error: unknown): Error | string => {
  if (error instanceof PlugError) {
    return new PlugError(error.message, {
      code: error.code,
      statusCode: error.statusCode,
      correlationId: error.correlationId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      description: resolveReasonDescription(error) ?? error.description,
      authRelated: error.authRelated,
    });
  }

  if (error instanceof Error || typeof error === "string") {
    return error;
  }

  if (isRecord(error)) {
    return JSON.stringify(error);
  }

  return new Error("Unknown error");
};

export const serializeErrorForContinueOnFail = (
  error: unknown,
): Record<string, unknown> => {
  if (error instanceof PlugError) {
    return compactRecord({
      message: error.message,
      description: error.description,
      code: error.code,
      statusCode: error.statusCode,
      correlationId: error.correlationId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
    });
  }

  if (error instanceof Error) {
    return compactRecord({
      message: error.message,
      name: error.name,
    });
  }

  return {
    message: "Unknown error",
  };
};
