import type { JsonObject } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";

export const assertRecord = (value: unknown, label: string): JsonObject => {
  if (!isRecord(value)) {
    throw new PlugValidationError(`${label} must be an object`);
  }

  return value;
};

export const assertString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlugValidationError(`${label} must be a non-empty string`);
  }

  return value;
};

export const assertNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PlugValidationError(`${label} must be a number`);
  }

  return value;
};

export const assertStringArray = (value: unknown, label: string): string[] => {
  if (!Array.isArray(value)) {
    throw new PlugValidationError(`${label} must be an array`);
  }

  return value.map((item, index) => assertString(item, `${label}[${index}]`));
};

export const assertRecordArray = <TRecord extends JsonObject>(
  value: unknown,
  label: string,
): TRecord[] => {
  if (!Array.isArray(value)) {
    throw new PlugValidationError(`${label} must be an array`);
  }

  return value.map((item, index) => assertRecord(item, `${label}[${index}]`) as TRecord);
};

export const assertOptionalString = (value: unknown): string | null | undefined => {
  if (value === null || value === undefined) {
    return value;
  }

  return typeof value === "string" ? value : undefined;
};
