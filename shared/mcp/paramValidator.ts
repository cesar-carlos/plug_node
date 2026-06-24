import type { ParamSchema, ValidationResult } from "./contracts";

const isNullish = (value: unknown): boolean => value === null || value === undefined;

const coerceString = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
};

const coerceBoolean = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  return undefined;
};

const coerceObject = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim() !== "") {
    try {
      const parsed: unknown = JSON.parse(value);
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
};

const coerceParamValue = (
  name: string,
  schema: ParamSchema,
  rawValue: unknown,
): ValidationResult => {
  if (isNullish(rawValue)) {
    if (schema.required === true) {
      return { ok: false, error: `Parameter "${name}" is required.` };
    }
    if (schema.default !== undefined) {
      return { ok: true, coerced: { [name]: schema.default } };
    }
    return { ok: true, coerced: { [name]: null } };
  }

  let coerced: unknown;
  switch (schema.type) {
    case "string": {
      const stringValue = coerceString(rawValue);
      if (stringValue === undefined) {
        return { ok: false, error: `Parameter "${name}" must be a string.` };
      }
      coerced = stringValue;
      break;
    }
    case "number": {
      const numberValue = coerceNumber(rawValue);
      if (numberValue === undefined) {
        return { ok: false, error: `Parameter "${name}" must be a number.` };
      }
      if (schema.minimum !== undefined && numberValue < schema.minimum) {
        return {
          ok: false,
          error: `Parameter "${name}" must be at least ${schema.minimum}.`,
        };
      }
      if (schema.maximum !== undefined && numberValue > schema.maximum) {
        return {
          ok: false,
          error: `Parameter "${name}" must be at most ${schema.maximum}.`,
        };
      }
      coerced = numberValue;
      break;
    }
    case "boolean": {
      const booleanValue = coerceBoolean(rawValue);
      if (booleanValue === undefined) {
        return { ok: false, error: `Parameter "${name}" must be a boolean.` };
      }
      coerced = booleanValue;
      break;
    }
    case "object": {
      const objectValue = coerceObject(rawValue);
      if (objectValue === undefined) {
        return { ok: false, error: `Parameter "${name}" must be a JSON object.` };
      }
      coerced = objectValue;
      break;
    }
    default: {
      const exhaustiveCheck: never = schema.type;
      return {
        ok: false,
        error: `Unsupported parameter type for "${name}": ${exhaustiveCheck}`,
      };
    }
  }

  return { ok: true, coerced: { [name]: coerced } };
};

export const validateParams = (
  schemas: Readonly<Record<string, ParamSchema>>,
  rawParams: Readonly<Record<string, unknown>>,
): ValidationResult => {
  const coerced: Record<string, unknown> = {};

  for (const [name, schema] of Object.entries(schemas)) {
    const result = coerceParamValue(name, schema, rawParams[name]);
    if (!result.ok) {
      return result;
    }
    Object.assign(coerced, result.coerced);
  }

  for (const name of Object.keys(rawParams)) {
    if (!(name in schemas)) {
      return {
        ok: false,
        error: `Unknown parameter "${name}" is not accepted by this capability.`,
      };
    }
  }

  return { ok: true, coerced };
};
