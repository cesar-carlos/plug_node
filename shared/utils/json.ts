import { PlugValidationError } from "../contracts/errors";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const safeStringify = (value: unknown): string => JSON.stringify(value);

export const parseJsonText = (value: string, label: string): unknown => {
  try {
    return JSON.parse(value);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    throw new PlugValidationError(`${label} must be valid JSON`, {
      label,
      technicalMessage: message,
    });
  }
};

export const parseOptionalJsonObject = (
  value: string,
  label: string,
): Record<string, unknown> | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const parsed = parseJsonText(trimmed, label);
  if (!isRecord(parsed)) {
    throw new PlugValidationError(`${label} must be a JSON object`);
  }

  return parsed;
};

export const parseOptionalJsonArray = (
  value: string,
  label: string,
): unknown[] | undefined => {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const parsed = parseJsonText(trimmed, label);
  if (!Array.isArray(parsed)) {
    throw new PlugValidationError(`${label} must be a JSON array`);
  }

  return parsed;
};

export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";
