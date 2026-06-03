import type { IDataObject, IExecuteFunctions } from "n8n-workflow";

export const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

export const toOptionalPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
};

export const toOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

export const toCollection = (
  context: IExecuteFunctions,
  parameterName: string,
  itemIndex: number,
): IDataObject => context.getNodeParameter(parameterName, itemIndex, {}) as IDataObject;
