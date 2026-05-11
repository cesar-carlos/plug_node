import { PlugValidationError } from "../contracts/errors";
import { assertCustomSocketEventName } from "../contracts/custom-socket-events";
import { isRecord, parseJsonText } from "../utils/json";

const asString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlugValidationError(`${label} must be a non-empty string`);
  }

  return value.trim();
};

const parseJsonObjectValue = (value: unknown, label: string): Record<string, unknown> => {
  if (isRecord(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = parseJsonText(value, label);
    if (isRecord(parsed)) {
      return parsed;
    }
  }

  throw new PlugValidationError(`${label} must be a JSON object`);
};

const parseJsonArrayValue = (value: unknown, label: string): unknown[] => {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = parseJsonText(value, label);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  }

  throw new PlugValidationError(`${label} must be a JSON array`);
};

export const buildSocketEventPayload = (
  eventNameValue: unknown,
  payloadValue: unknown,
): { eventName: string; payload: unknown } => ({
  eventName: assertCustomSocketEventName(eventNameValue),
  payload:
    typeof payloadValue === "string" && payloadValue.trim()
      ? parseJsonText(payloadValue, "Payload JSON")
      : payloadValue,
});

export const validateClientToken = (
  tokenValue: unknown,
): { valid: boolean; tokenLength: number; warnings: string[] } => {
  const token = asString(tokenValue, "Client Token");
  const warnings: string[] = [];
  if (token.length < 16) {
    warnings.push("Token is shorter than the recommended minimum of 16 characters.");
  }
  if (token.length > 4096) {
    return {
      valid: false,
      tokenLength: token.length,
      warnings: ["Token exceeds 4096 characters."],
    };
  }

  return { valid: true, tokenLength: token.length, warnings };
};

export const validateAgentContext = (
  agentIdValue: unknown,
  clientTokenValue: unknown,
): {
  valid: boolean;
  agentId: string;
  tokenLength: number;
  warnings: string[];
} => {
  const agentId = asString(agentIdValue, "Agent ID");
  const token = validateClientToken(clientTokenValue);
  return {
    valid: token.valid,
    agentId,
    tokenLength: token.tokenLength,
    warnings: token.warnings,
  };
};

export const buildSqlRequest = (
  agentIdValue: unknown,
  sqlValue: unknown,
  paramsValue: unknown,
): { agentId: string; sql: string; params: unknown[] } => ({
  agentId: asString(agentIdValue, "Agent ID"),
  sql: asString(sqlValue, "SQL"),
  params:
    paramsValue === undefined || paramsValue === null || paramsValue === ""
      ? []
      : parseJsonArrayValue(paramsValue, "SQL Params JSON"),
});

export const parseSqlRows = (
  rowsValue: unknown,
): { rows: unknown[]; rowCount: number; columns: string[] } => {
  const rows = parseJsonArrayValue(rowsValue, "Rows JSON");
  const columns = new Set<string>();
  for (const row of rows) {
    if (isRecord(row)) {
      for (const key of Object.keys(row)) {
        columns.add(key);
      }
    }
  }

  return {
    rows,
    rowCount: rows.length,
    columns: [...columns],
  };
};

export const generateAccessRequestSummary = (
  value: unknown,
): {
  summary: string;
  clientAgentId?: string;
  requestedAgentId?: string;
  status?: string;
} => {
  const request = parseJsonObjectValue(value, "Access Request JSON");
  const clientAgentId =
    typeof request.clientAgentId === "string" ? request.clientAgentId : undefined;
  const requestedAgentId =
    typeof request.requestedAgentId === "string" ? request.requestedAgentId : undefined;
  const status = typeof request.status === "string" ? request.status : undefined;

  return {
    summary: `Access request${status ? ` (${status})` : ""}${clientAgentId ? ` from ${clientAgentId}` : ""}${requestedAgentId ? ` to ${requestedAgentId}` : ""}`,
    ...(clientAgentId ? { clientAgentId } : {}),
    ...(requestedAgentId ? { requestedAgentId } : {}),
    ...(status ? { status } : {}),
  };
};
