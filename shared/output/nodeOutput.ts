import type {
  JsonObject,
  NormalizedAgentRpcResponse,
  NormalizedRpcBatchResponse,
  NormalizedRpcSingleResponse,
  PlugCommandTransportResult,
  PlugResponseMode,
} from "../contracts/api";
import { PlugError } from "../contracts/errors";
import { ensureSuccessfulNormalizedResponse } from "./rpcNormalization";
import { isRecord } from "../utils/json";

const toMetadata = (result: PlugCommandTransportResult): JsonObject => ({
  channel: result.channel,
  agentId: result.agentId,
  requestId: result.requestId,
  ...(result.channel === "socket"
    ? {
        socketMode: result.socketMode,
        ...("conversationId" in result && result.conversationId
          ? { conversationId: result.conversationId }
          : {}),
      }
    : {}),
});

const cloneRows = (rows: unknown[]): unknown[] => rows.map((row) => row);

const aggregateSocketSqlStream = (
  response: NormalizedAgentRpcResponse,
  chunkPayloads: JsonObject[],
  completePayload?: JsonObject,
): NormalizedAgentRpcResponse => {
  if (
    response.type !== "single" ||
    !response.item.success ||
    !isRecord(response.item.result)
  ) {
    return response;
  }

  if (typeof response.item.result.stream_id !== "string") {
    return response;
  }

  const baseResult = { ...response.item.result };
  const initialRows = Array.isArray(baseResult.rows) ? cloneRows(baseResult.rows) : [];
  const chunkRows = chunkPayloads.flatMap((chunk) =>
    Array.isArray(chunk.rows) ? chunk.rows : [],
  );

  if (completePayload) {
    const status =
      typeof completePayload.terminal_status === "string"
        ? completePayload.terminal_status
        : undefined;
    if (status === "aborted" || status === "error") {
      throw new PlugError(
        status === "aborted"
          ? "The socket SQL stream was aborted before completion."
          : "The socket SQL stream ended with an error.",
        {
          code: status === "aborted" ? "SOCKET_STREAM_ABORTED" : "SOCKET_STREAM_ERROR",
          description:
            "Try again or reduce the query size. Large socket streams may need pagination or lower Max Rows.",
          details: {
            completePayload,
          },
        },
      );
    }
  }

  delete baseResult.stream_id;
  return {
    ...response,
    item: {
      ...response.item,
      result: {
        ...baseResult,
        rows: [...initialRows, ...chunkRows],
      },
    },
  };
};

const withOptionalMetadata = (
  includeMetadata: boolean,
  metadata: JsonObject,
): { __plug?: JsonObject } => (includeMetadata ? { __plug: metadata } : {});

const buildSingleSuccessItems = (
  response: NormalizedRpcSingleResponse,
  metadata: JsonObject,
  includeMetadata: boolean,
): JsonObject[] => {
  const resultPayload = response.item.result;

  if (isRecord(resultPayload) && Array.isArray(resultPayload.rows)) {
    return resultPayload.rows.map((row, index) => ({
      ...(isRecord(row) ? row : { value: row }),
      ...withOptionalMetadata(includeMetadata, {
        ...metadata,
        rowIndex: index,
      }),
    }));
  }

  return [
    {
      ...withOptionalMetadata(includeMetadata, metadata),
      result: resultPayload,
      ...(response.item.api_version ? { apiVersion: response.item.api_version } : {}),
    },
  ];
};

const buildBatchSuccessItems = (
  response: NormalizedRpcBatchResponse,
  metadata: JsonObject,
  includeMetadata: boolean,
): JsonObject[] => [
  {
    ...withOptionalMetadata(includeMetadata, metadata),
    response,
  },
];

export const buildNodeOutputItems = (
  result: PlugCommandTransportResult,
  responseMode: PlugResponseMode,
  includeMetadata = true,
): JsonObject[] => {
  if (result.notification) {
    return [
      {
        ...withOptionalMetadata(includeMetadata, toMetadata(result)),
        notification: true,
        acceptedCommands: result.acceptedCommands,
      },
    ];
  }

  const response =
    result.channel === "socket"
      ? aggregateSocketSqlStream(
          result.response,
          result.chunkPayloads,
          result.completePayload,
        )
      : result.response;

  if (responseMode === "rawJsonRpc") {
    return [
      {
        ...withOptionalMetadata(includeMetadata, toMetadata(result)),
        response,
        ...(result.channel === "socket"
          ? {
              rawResponsePayload: result.rawResponsePayload,
              chunkPayloads: result.chunkPayloads,
              completePayload: result.completePayload,
            }
          : {}),
      },
    ];
  }

  if (responseMode === "chunkItems" && result.channel === "socket") {
    return result.chunkPayloads.map((chunkPayload, index) => ({
      ...withOptionalMetadata(includeMetadata, {
        ...toMetadata(result),
        chunkIndex: index,
      }),
      chunk: chunkPayload,
    }));
  }

  const successfulResponse = ensureSuccessfulNormalizedResponse(response, {
    agentId: result.agentId,
    requestId: result.requestId,
  });

  if (successfulResponse.type === "single") {
    return buildSingleSuccessItems(
      successfulResponse,
      toMetadata(result),
      includeMetadata,
    );
  }

  return buildBatchSuccessItems(successfulResponse, toMetadata(result), includeMetadata);
};
