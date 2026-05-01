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

const extractUserMessage = (error: NormalizedRpcError): string => {
  const data = error.data;
  if (data && typeof data.user_message === "string" && data.user_message.trim() !== "") {
    return data.user_message;
  }

  return error.message;
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

  const retryAfterSeconds =
    typeof item.error.data?.retry_after_ms === "number"
      ? Math.ceil(item.error.data.retry_after_ms / 1000)
      : undefined;

  const correlationId =
    typeof item.error.data?.correlation_id === "string"
      ? item.error.data.correlation_id
      : context.requestId;

  return new PlugError(extractUserMessage(item.error), {
    code: `RPC_${item.error.code}`,
    correlationId,
    retryable: item.error.code === -32013,
    retryAfterSeconds,
    details: {
      agentId: context.agentId,
      requestId: context.requestId,
      rpcError: item.error,
      rpcItemId: item.id,
    },
    technicalMessage: item.error.message,
  });
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
