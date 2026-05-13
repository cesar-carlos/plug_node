import { PlugError } from "../contracts/errors";

const compactRecord = (value: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined),
  );

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
