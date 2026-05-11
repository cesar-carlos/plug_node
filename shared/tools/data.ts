import Ajv from "ajv";
import addFormats from "ajv-formats";
import Papa from "papaparse";
import jsonata from "jsonata";

import { PlugValidationError } from "../contracts/errors";
import { isRecord, parseJsonText } from "../utils/json";

export interface RegexExtraction {
  readonly pattern: string;
  readonly flags: string;
  readonly matches: Array<{
    readonly match: string;
    readonly index: number;
    readonly groups: readonly string[];
    readonly namedGroups?: Record<string, string>;
  }>;
}

export const transformJson = async (
  input: unknown,
  expressionText: unknown,
): Promise<unknown> => {
  if (typeof expressionText !== "string" || expressionText.trim() === "") {
    throw new PlugValidationError("JSONata Expression must be a non-empty string");
  }

  const expression = jsonata(expressionText);
  return expression.evaluate(input);
};

export const csvToJson = (csv: unknown, options: Record<string, unknown>): unknown[] => {
  if (typeof csv !== "string") {
    throw new PlugValidationError("CSV must be a string");
  }

  const result = Papa.parse(csv, {
    header: options.header !== false,
    skipEmptyLines: options.skipEmptyLines !== false,
    delimiter: typeof options.delimiter === "string" ? options.delimiter : "",
    dynamicTyping: options.dynamicTyping === true,
  });

  if (result.errors.length > 0) {
    throw new PlugValidationError("CSV could not be parsed", {
      technicalMessage: result.errors
        .map((error: Papa.ParseError) => error.message)
        .join("; "),
    });
  }

  return result.data as unknown[];
};

export const jsonToCsv = (data: unknown, options: Record<string, unknown>): string => {
  const rows = Array.isArray(data) ? data : [data];
  return Papa.unparse(rows, {
    delimiter:
      typeof options.delimiter === "string" && options.delimiter
        ? options.delimiter
        : ",",
    header: options.header !== false,
  });
};

export const normalizeText = (
  value: unknown,
  options: {
    readonly trim?: boolean;
    readonly collapseWhitespace?: boolean;
    readonly removeAccents?: boolean;
    readonly caseMode?: string;
  },
): string => {
  if (typeof value !== "string") {
    throw new PlugValidationError("Text must be a string");
  }

  let output = value;
  if (options.removeAccents) {
    output = output.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  }
  if (options.collapseWhitespace !== false) {
    output = output.replace(/\s+/gu, " ");
  }
  if (options.trim !== false) {
    output = output.trim();
  }
  if (options.caseMode === "lower") {
    output = output.toLowerCase();
  } else if (options.caseMode === "upper") {
    output = output.toUpperCase();
  }

  return output;
};

export const extractRegexFields = (
  text: unknown,
  pattern: unknown,
  flagsValue: unknown,
): RegexExtraction => {
  if (typeof text !== "string") {
    throw new PlugValidationError("Text must be a string");
  }
  if (typeof pattern !== "string" || pattern.trim() === "") {
    throw new PlugValidationError("Regex Pattern must be a non-empty string");
  }

  const rawFlags = typeof flagsValue === "string" ? flagsValue : "g";
  const flags = rawFlags.includes("g") ? rawFlags : `${rawFlags}g`;
  const regex = new RegExp(pattern, flags);
  const matches = Array.from(text.matchAll(regex), (match) => ({
    match: match[0],
    index: match.index ?? 0,
    groups: match.slice(1),
    ...(match.groups ? { namedGroups: { ...match.groups } } : {}),
  }));

  return {
    pattern,
    flags,
    matches,
  };
};

export const validateJsonSchema = (
  data: unknown,
  schemaValue: unknown,
): { valid: boolean; errors: unknown[] } => {
  const schema =
    typeof schemaValue === "string"
      ? parseJsonText(schemaValue, "JSON Schema")
      : schemaValue;
  if (!isRecord(schema) && !Array.isArray(schema)) {
    throw new PlugValidationError("JSON Schema must be a JSON object or boolean schema");
  }

  const ajv = new Ajv({ allErrors: true, strict: false });
  (addFormats as unknown as (instance: Ajv) => void)(ajv);
  const validate = ajv.compile(schema);
  const valid = Boolean(validate(data));
  return {
    valid,
    errors: valid ? [] : [...(validate.errors ?? [])],
  };
};
