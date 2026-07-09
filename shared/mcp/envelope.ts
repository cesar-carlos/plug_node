import { isRecord } from "../utils/json";
import type { McpCallResponse } from "./contracts";

export interface PlugExecutionRowResult {
  readonly rows?: readonly Record<string, unknown>[];
  readonly rowCount?: number;
  readonly emptyResult?: boolean;
}

const readPlugMeta = (
  json: Record<string, unknown>,
): Record<string, unknown> | undefined => {
  const plugMeta = json.__plug;
  return isRecord(plugMeta) ? plugMeta : undefined;
};

export const extractPlugExecutionResult = (
  jsonItems: readonly Record<string, unknown>[],
): PlugExecutionRowResult => {
  if (jsonItems.length === 0) {
    return { rows: [], rowCount: 0, emptyResult: true };
  }

  const firstItem = jsonItems[0];
  const plugMeta = readPlugMeta(firstItem);
  const emptyResult = plugMeta?.emptyResult === true;

  if (Array.isArray(firstItem.rows)) {
    const rows = firstItem.rows.filter(isRecord);
    const rowCount =
      typeof firstItem.rowCount === "number" ? firstItem.rowCount : rows.length;
    return {
      rows,
      rowCount,
      emptyResult: emptyResult || rowCount === 0,
    };
  }

  if (emptyResult) {
    return { rows: [], rowCount: 0, emptyResult: true };
  }

  return {
    rows: jsonItems.filter(isRecord),
    rowCount: jsonItems.length,
    emptyResult: false,
  };
};

export const buildMcpCallResponse = (input: {
  readonly capability: string;
  readonly rows: readonly Record<string, unknown>[];
  readonly rowCount: number;
  readonly maxRows: number;
  readonly executionMs: number;
  readonly emptyResult: boolean;
}): McpCallResponse => {
  const truncated = !input.emptyResult && input.rowCount >= input.maxRows;
  const textPayload = input.emptyResult
    ? JSON.stringify({ message: "No records found for the provided filters." })
    : JSON.stringify(input.rows);

  return {
    content: [{ type: "text", text: textPayload }],
    meta: {
      capability: input.capability,
      rowCount: input.rowCount,
      truncated,
      executionMs: input.executionMs,
      emptyResult: input.emptyResult,
    },
  };
};

export const buildMcpError = (input: {
  readonly capability: string;
  readonly message: string;
  readonly executionMs: number;
}): McpCallResponse => ({
  content: [{ type: "text", text: input.message }],
  meta: {
    capability: input.capability,
    executionMs: input.executionMs,
  },
  isError: true,
});
