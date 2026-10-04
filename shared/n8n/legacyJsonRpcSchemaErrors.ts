import type { z } from "zod4";

const receivedType = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number" && Number.isNaN(value)) return "nan";
  return typeof value;
};

const quotedOptions = (values: readonly unknown[]): string =>
  values.map((value) => `'${String(value)}'`).join(" | ");

// Compatibility bridge: preserve the published JSON-RPC validation messages.
// Remove only when the public error contract intentionally changes.
export const legacyJsonRpcSchemaError: z.core.$ZodErrorMap = (
  issue,
): string | undefined => {
  switch (issue.code) {
    case "invalid_type":
      if (issue.input === undefined) return "Required";
      return `Expected ${issue.expected === "record" ? "object" : issue.expected}, received ${receivedType(issue.input)}`;
    case "invalid_union":
      if (issue.discriminator && "options" in issue && Array.isArray(issue.options)) {
        return `Invalid discriminator value. Expected ${quotedOptions(issue.options)}`;
      }
      return "Invalid input";
    case "invalid_value":
      if (issue.values.length === 1) {
        return `Invalid literal value, expected ${JSON.stringify(issue.values[0])}`;
      }
      if (issue.input === undefined) return "Required";
      if (typeof issue.input !== "string") {
        return `Expected ${quotedOptions(issue.values)}, received ${receivedType(issue.input)}`;
      }
      return `Invalid enum value. Expected ${quotedOptions(issue.values)}, received '${issue.input}'`;
    case "unrecognized_keys":
      return `Unrecognized key(s) in object: ${issue.keys.map((key) => `'${key}'`).join(", ")}`;
    case "too_small":
      if (issue.origin === "number") {
        return `Number must be greater than ${issue.inclusive ? "or equal to " : ""}${issue.minimum}`;
      }
      if (issue.origin === "string") {
        return `String must contain at least ${issue.minimum} character(s)`;
      }
      if (issue.origin === "array") {
        return `Array must contain at least ${issue.minimum} element(s)`;
      }
      return undefined;
    default:
      return undefined;
  }
};
