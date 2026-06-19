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

const readTransportExecutionMetrics = (
  result: PlugCommandTransportResult,
): JsonObject | undefined => {
  if (result.notification) {
    return undefined;
  }

  if (!("executionMetrics" in result) || !result.executionMetrics) {
    return undefined;
  }

  const metrics = result.executionMetrics;
  const transport: JsonObject = {};

  if (typeof metrics.attemptCount === "number") {
    transport.attemptCount = metrics.attemptCount;
  }

  if (typeof metrics.lastRetryDelayMs === "number") {
    transport.lastRetryDelayMs = metrics.lastRetryDelayMs;
  }

  if (typeof metrics.connectedAfterMs === "number") {
    transport.connectedAfterMs = metrics.connectedAfterMs;
  }

  if (metrics.serverTimings) {
    transport.serverTimings = metrics.serverTimings;
  }

  return Object.keys(transport).length > 0 ? transport : undefined;
};

const toMetadata = (result: PlugCommandTransportResult): JsonObject => {
  const transportMetrics = readTransportExecutionMetrics(result);

  return {
    channel: result.channel,
    agentId: result.agentId,
    requestId: result.requestId,
    ...(transportMetrics ? { transport: transportMetrics } : {}),
    ...(result.channel === "socket"
      ? {
          socketMode: result.socketMode,
          ...("conversationId" in result && result.conversationId
            ? { conversationId: result.conversationId }
            : {}),
          ...("accepted" in result && result.accepted
            ? {
                clientRequestId: result.accepted.clientRequestId,
                deduplicated: result.accepted.deduplicated,
                replayed: result.accepted.replayed,
                inFlight: result.accepted.inFlight,
              }
            : {}),
          ...(result.metrics ? { metrics: result.metrics } : {}),
        }
      : {}),
  };
};

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

  const { stream_id: streamId, ...resultWithoutStreamId } = response.item.result;
  void streamId;
  const initialRows = Array.isArray(resultWithoutStreamId.rows)
    ? [...(resultWithoutStreamId.rows as unknown[])]
    : [];
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

  return {
    ...response,
    item: {
      ...response.item,
      result: {
        ...resultWithoutStreamId,
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
  responseMode: PlugResponseMode,
): JsonObject[] => {
  const resultPayload = response.item.result;

  if (isRecord(resultPayload)) {
    const rows = resultPayload.rows;
    const hasRowsArray = Array.isArray(rows);
    const explicitRowCount = resultPayload.row_count ?? resultPayload.rowCount;
    const isEmptyAggregatedResult =
      responseMode === "aggregatedJson" &&
      ((hasRowsArray && rows.length === 0) || (!hasRowsArray && explicitRowCount === 0));

    if (isEmptyAggregatedResult) {
      return [
        {
          rowCount: 0,
          rows: hasRowsArray ? rows : [],
          ...withOptionalMetadata(includeMetadata, {
            ...metadata,
            emptyResult: true,
          }),
        },
      ];
    }

    if (hasRowsArray) {
      return rows.map((row, index) => ({
        ...(isRecord(row) ? row : { value: row }),
        ...withOptionalMetadata(includeMetadata, {
          ...metadata,
          rowIndex: index,
        }),
      }));
    }
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
    result.channel === "socket" && responseMode !== "chunkItems"
      ? aggregateSocketSqlStream(
          result.response,
          result.chunkPayloads,
          result.completePayload,
        )
      : result.channel === "socket"
        ? result.response
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
      responseMode,
    );
  }

  return buildBatchSuccessItems(successfulResponse, toMetadata(result), includeMetadata);
};
