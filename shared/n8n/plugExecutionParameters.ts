import type { IDataObject, IExecuteFunctions } from "n8n-workflow";

import { PlugValidationError } from "../contracts/errors";

export { toOptionalString } from "../utils/strings";

export const toOptionalPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
};

export const toOptionalPositiveInteger = (
  value: unknown,
  label: string,
): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    if (value === undefined || value === null || value === 0) {
      return undefined;
    }

    throw new PlugValidationError(`${label} must be a positive number`);
  }

  return Math.trunc(value);
};

export const toOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const toCollection = (
  context: IExecuteFunctions,
  parameterName: string,
  itemIndex: number,
): IDataObject => context.getNodeParameter(parameterName, itemIndex, {}) as IDataObject;

export const toPositiveNumber = (
  value: unknown,
  fallback: number,
  label: string,
): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PlugValidationError(`${label} must be a positive number`);
  }

  return value;
};

export const toNonNegativeNumber = (
  value: unknown,
  fallback: number,
  label: string,
): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new PlugValidationError(`${label} must be zero or a positive number`);
  }

  return value;
};

export const toPositiveInteger = (
  value: unknown,
  fallback: number,
  label: string,
): number => {
  const numberValue = toPositiveNumber(value, fallback, label);
  if (!Number.isInteger(numberValue)) {
    throw new PlugValidationError(`${label} must be an integer`);
  }

  return numberValue;
};

export const toCappedPositiveInteger = (
  value: unknown,
  fallback: number,
  label: string,
  hardLimit: number,
): number => {
  const normalized = toPositiveInteger(value, fallback, label);
  if (normalized > hardLimit) {
    throw new PlugValidationError(
      `${label} must be less than or equal to ${hardLimit} bytes`,
    );
  }

  return normalized;
};
