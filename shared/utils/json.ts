import { PlugValidationError } from "../contracts/errors";

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const safeStringify = (value: unknown): string => JSON.stringify(value);

export const estimateJsonUtf8Bytes = (value: unknown): number =>
  Buffer.byteLength(safeStringify(value), "utf8");

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

export const parseOptionalJsonStringArray = (
  value: string,
  label: string,
): string[] | undefined => {
  const parsed = parseOptionalJsonArray(value, label);
  if (!parsed) {
    return undefined;
  }

  const items = parsed.map((item, index) => {
    if (typeof item !== "string" || item.trim() === "") {
      throw new PlugValidationError(`${label} item at index ${index} must be a string`);
    }

    return item.trim();
  });

  return items;
};

export const parseStringListCollection = (
  value: unknown,
  label: string,
  fieldName: string,
): string[] => {
  if (!isRecord(value)) {
    throw new PlugValidationError(`${label} must be a collection`);
  }

  const rows = Array.isArray(value.values) ? value.values : [];
  const items = rows.map((row, index) => {
    if (!isRecord(row)) {
      throw new PlugValidationError(`${label} row ${index + 1} must be an object`);
    }

    const cell = row[fieldName];
    if (typeof cell !== "string" || cell.trim() === "") {
      throw new PlugValidationError(
        `${label} row ${index + 1} must include a non-empty ${fieldName}`,
      );
    }

    return cell.trim();
  });

  return items;
};

export const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";
