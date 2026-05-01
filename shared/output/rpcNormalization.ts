import type {
  JsonObject,
  JsonRpcId,
  NormalizedAgentRpcResponse,
  NormalizedRpcBatchResponse,
  NormalizedRpcError,
  NormalizedRpcItem,
  NormalizedRpcSingleResponse,
} from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";

const isJsonRpcId = (value: unknown): value is JsonRpcId =>
  value === null || typeof value === "string" || typeof value === "number";

interface RpcErrorDataView {
  readonly reason?: string;
  readonly category?: string;
  readonly resource?: string;
  readonly deniedResources?: string[];
  readonly retryable?: boolean;
  readonly userMessage?: string;
  readonly technicalMessage?: string;
  readonly correlationId?: string;
  readonly timestamp?: string;
  readonly retryAfterMs?: number;
  readonly resetAt?: string;
}

const normalizeRpcError = (value: unknown): NormalizedRpcError => {
  if (!isRecord(value)) {
    return {
      code: -32603,
      message: "Invalid JSON-RPC error payload",
    };
  }

  return {
    code: typeof value.code === "number" ? value.code : -32603,
    message:
      typeof value.message === "string" && value.message.trim() !== ""
        ? value.message
        : "JSON-RPC error",
    data: isRecord(value.data) ? value.data : undefined,
  };
};

const normalizeRpcItem = (value: unknown): NormalizedRpcItem => {
  if (!isRecord(value)) {
    return {
      success: false,
      error: {
        code: -32603,
        message: "Invalid JSON-RPC payload",
      },
    };
  }

  if ("error" in value) {
    return {
      id: isJsonRpcId(value.id) ? value.id : undefined,
      success: false,
      error: normalizeRpcError(value.error),
      api_version: typeof value.api_version === "string" ? value.api_version : undefined,
      meta: isRecord(value.meta) ? (value.meta as JsonObject) : undefined,
    };
  }

  return {
    id: isJsonRpcId(value.id) ? value.id : undefined,
    success: true,
    result: value.result,
    api_version: typeof value.api_version === "string" ? value.api_version : undefined,
    meta: isRecord(value.meta) ? (value.meta as JsonObject) : undefined,
  };
};

export const normalizeRpcPayload = (payload: unknown): NormalizedAgentRpcResponse => {
  if (Array.isArray(payload)) {
    const items = payload.map((item) => normalizeRpcItem(item));
    return {
      type: "batch",
      success: items.every((item) => item.success),
      items,
    };
  }

  if (!isRecord(payload)) {
    return {
      type: "raw",
      success: false,
      payload,
    };
  }

  if ("result" in payload || "error" in payload) {
    const item = normalizeRpcItem(payload);
    return {
      type: "single",
      success: item.success,
      item,
      api_version:
        typeof payload.api_version === "string" ? payload.api_version : undefined,
      meta: isRecord(payload.meta) ? (payload.meta as JsonObject) : undefined,
    };
  }

  return {
    type: "raw",
    success: false,
    payload,
  };
};

const readRpcErrorData = (error: NormalizedRpcError): RpcErrorDataView => {
  const data = error.data;
  if (!data) {
    return {};
  }

  return {
    ...(typeof data.reason === "string" && data.reason.trim() !== ""
      ? { reason: data.reason }
      : {}),
    ...(typeof data.category === "string" && data.category.trim() !== ""
      ? { category: data.category }
      : {}),
    ...(typeof data.resource === "string" && data.resource.trim() !== ""
      ? { resource: data.resource }
      : {}),
    ...(Array.isArray(data.denied_resources)
      ? {
          deniedResources: data.denied_resources.filter(
            (resource): resource is string =>
              typeof resource === "string" && resource.trim() !== "",
          ),
        }
      : {}),
    ...(typeof data.retryable === "boolean" ? { retryable: data.retryable } : {}),
    ...(typeof data.user_message === "string" && data.user_message.trim() !== ""
      ? { userMessage: data.user_message }
      : {}),
    ...(typeof data.technical_message === "string" && data.technical_message.trim() !== ""
      ? { technicalMessage: data.technical_message }
      : {}),
    ...(typeof data.correlation_id === "string" && data.correlation_id.trim() !== ""
      ? { correlationId: data.correlation_id }
      : {}),
    ...(typeof data.timestamp === "string" && data.timestamp.trim() !== ""
      ? { timestamp: data.timestamp }
      : {}),
    ...(typeof data.retry_after_ms === "number" && Number.isFinite(data.retry_after_ms)
      ? { retryAfterMs: data.retry_after_ms }
      : {}),
    ...(typeof data.reset_at === "string" && data.reset_at.trim() !== ""
      ? { resetAt: data.reset_at }
      : {}),
  };
};

const parseResetAtToSeconds = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }

  const deltaMs = timestamp - Date.now();
  return deltaMs > 0 ? Math.max(1, Math.ceil(deltaMs / 1000)) : 1;
};

const buildRpcRetryAfterSeconds = (data: RpcErrorDataView): number | undefined => {
  if (typeof data.retryAfterMs === "number") {
    return Math.max(1, Math.ceil(data.retryAfterMs / 1000));
  }

  return parseResetAtToSeconds(data.resetAt);
};

const isAgentOfflineError = (
  error: NormalizedRpcError,
  data: RpcErrorDataView,
): boolean =>
  error.message === "agent_offline" ||
  data.reason === "agent_offline" ||
  data.reason === "agent_disconnected_at_dispatch";

const getFallbackRpcUserMessage = (
  error: NormalizedRpcError,
  data: RpcErrorDataView,
): string => {
  if (isAgentOfflineError(error, data)) {
    return "The agent is offline right now.";
  }

  switch (data.reason) {
    case "missing_client_token":
      return "The Client Token was not accepted by the agent.";
    case "token_revoked":
      return "The Client Token was revoked and can no longer be used.";
    case "sql_validation_failed":
      return "The SQL query is invalid for this agent.";
    case "sql_execution_failed":
      return "The agent could not execute the SQL query.";
    case "transaction_failed":
      return "The SQL batch transaction failed.";
    case "connection_pool_exhausted":
      return "The agent database pool is exhausted right now.";
    case "result_too_large":
      return "The query result is too large for the current limits.";
    case "database_connection_failed":
      return "The agent could not connect to the database.";
    case "query_timeout":
      return "The SQL query exceeded the allowed execution time.";
    case "execution_not_found":
      return "The requested SQL execution was not found.";
    case "execution_cancelled":
      return "The SQL execution was cancelled.";
    case "method_not_found":
      return "The selected operation is not supported by this agent.";
    case "invalid_request":
    case "invalid_params":
      return "The agent rejected the request payload.";
    case "rate_limited":
      return "The agent rate limited this operation.";
    case "invalid_signature":
      return "The agent rejected the signed payload.";
    default:
      break;
  }

  switch (error.code) {
    case -32013:
      return "The agent rate limited this operation.";
    case -32601:
      return "The selected operation is not supported by this agent.";
    case -32602:
      return "The agent rejected the request parameters.";
    default:
      return error.message;
  }
};

const buildRpcDescription = (
  error: NormalizedRpcError,
  data: RpcErrorDataView,
  retryAfterSeconds: number | undefined,
): string | undefined => {
  if (isAgentOfflineError(error, data)) {
    return "Reconnect the Plug agent and run the node again.";
  }

  if (data.reason === "missing_client_token") {
    return "Check the Client Token in the credential and confirm that this client still has access to the agent.";
  }

  if (data.reason === "token_revoked") {
    return "Generate or approve a new Client Token for this client and agent.";
  }

  if (data.reason === "sql_validation_failed") {
    return "Review the SQL text, named parameters, pagination settings, and database override before trying again.";
  }

  if (data.reason === "sql_execution_failed" || data.reason === "transaction_failed") {
    return "Review the SQL statement and the target database state before retrying.";
  }

  if (data.reason === "result_too_large") {
    return "Reduce Max Rows, paginate the query, or switch to socket streaming for larger results.";
  }

  if (
    data.reason === "connection_pool_exhausted" ||
    data.reason === "database_connection_failed" ||
    data.reason === "query_timeout"
  ) {
    return "Try again later or reduce the query cost and timeout settings.";
  }

  if (data.reason === "method_not_found") {
    return "Update the agent or choose an operation that its RPC profile exposes.";
  }

  if (
    data.reason === "invalid_signature" ||
    data.reason === "invalid_payload" ||
    data.reason === "decoding_failed" ||
    data.reason === "compression_failed"
  ) {
    return "Check transport compatibility between the node and the agent. Payload signing may be enforced in this environment.";
  }

  if (
    data.reason === "authentication_failed" ||
    data.reason === "unauthorized" ||
    data.reason === "invalid_request" ||
    data.reason === "invalid_params"
  ) {
    return "Check User (email), Password, Agent ID, Client Token, and any advanced JSON fields.";
  }

  if (data.reason === "rate_limited" || error.code === -32013) {
    return retryAfterSeconds !== undefined
      ? `Wait ${retryAfterSeconds} second(s) before retrying this operation.`
      : "Wait a moment before retrying this operation.";
  }

  return undefined;
};

export const toPlugErrorFromRpcItem = (
  item: NormalizedRpcItem,
  context: {
    readonly agentId: string;
    readonly requestId: string;
  },
): PlugError => {
  if (item.error === undefined) {
    throw new PlugValidationError("RPC item does not contain an error payload");
  }

  const errorData = readRpcErrorData(item.error);
  const retryAfterSeconds = buildRpcRetryAfterSeconds(errorData);

  const correlationId = errorData.correlationId ?? context.requestId;

  return new PlugError(
    errorData.userMessage ?? getFallbackRpcUserMessage(item.error, errorData),
    {
      code: `RPC_${item.error.code}`,
      correlationId,
      retryable:
        typeof errorData.retryable === "boolean"
          ? errorData.retryable
          : item.error.code === -32013,
      retryAfterSeconds,
      description: buildRpcDescription(item.error, errorData, retryAfterSeconds),
      details: {
        agentId: context.agentId,
        requestId: context.requestId,
        ...(errorData.reason ? { reason: errorData.reason } : {}),
        ...(errorData.category ? { category: errorData.category } : {}),
        ...(errorData.resource ? { resource: errorData.resource } : {}),
        ...(errorData.deniedResources && errorData.deniedResources.length > 0
          ? { denied_resources: errorData.deniedResources }
          : {}),
        ...(errorData.timestamp ? { timestamp: errorData.timestamp } : {}),
        rpcError: item.error,
        rpcItemId: item.id,
      },
      technicalMessage: errorData.technicalMessage ?? item.error.message,
    },
  );
};

export const ensureSuccessfulNormalizedResponse = (
  response: NormalizedAgentRpcResponse,
  context: {
    readonly agentId: string;
    readonly requestId: string;
  },
): NormalizedRpcSingleResponse | NormalizedRpcBatchResponse => {
  if (response.type === "raw") {
    throw new PlugError("Plug returned an unrecognized RPC payload.", {
      code: "RPC_RAW_RESPONSE",
      correlationId: context.requestId,
      details: {
        agentId: context.agentId,
        requestId: context.requestId,
        payload: response.payload,
      },
    });
  }

  if (response.type === "single") {
    if (!response.item.success) {
      throw toPlugErrorFromRpcItem(response.item, context);
    }
    return response;
  }

  const firstError = response.items.find((item) => !item.success);
  if (firstError) {
    throw toPlugErrorFromRpcItem(firstError, context);
  }

  return response;
};
