import type { JsonObject, NormalizedAgentRpcResponse } from "../contracts/api";
import { isRecord } from "../utils/json";

export const isConsumerSingleSuccessWithRows = (
  value: unknown,
): value is {
  readonly item: {
    readonly result: {
      readonly rows: unknown[];
      readonly stream_id?: string;
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
} =>
  isRecord(value) &&
  value.type === "single" &&
  value.success === true &&
  isRecord(value.item) &&
  value.item.success === true &&
  isRecord(value.item.result) &&
  Array.isArray(value.item.result.rows);

export const tryMergeChunkRowsIntoConsumerResponse = (
  response: NormalizedAgentRpcResponse | undefined,
  chunk: JsonObject,
): NormalizedAgentRpcResponse | undefined => {
  if (
    !response ||
    !isConsumerSingleSuccessWithRows(response) ||
    !Array.isArray(chunk.rows) ||
    chunk.rows.length === 0
  ) {
    return undefined;
  }

  const targetRows = response.item.result.rows;
  for (const row of chunk.rows) {
    targetRows.push(row);
  }

  return response;
};

export const removeStreamMarkerFromConsumerResponse = (
  response: NormalizedAgentRpcResponse | undefined,
): NormalizedAgentRpcResponse | undefined => {
  if (!response || !isConsumerSingleSuccessWithRows(response)) {
    return response;
  }

  const { stream_id: streamId, ...resultWithoutStreamId } = response.item.result;
  void streamId;
  return {
    ...response,
    item: {
      ...response.item,
      result: {
        ...resultWithoutStreamId,
        rows: response.item.result.rows,
      },
    },
  } as NormalizedAgentRpcResponse;
};

export const attachRetryAfterToConsumerResponse = (
  response: NormalizedAgentRpcResponse | undefined,
  retryAfterSeconds: number | undefined,
): NormalizedAgentRpcResponse | undefined => {
  if (
    response?.type !== "single" ||
    response.item.success ||
    retryAfterSeconds === undefined
  ) {
    return response;
  }

  const retryAfterMs = retryAfterSeconds * 1000;
  const currentData = isRecord(response.item.error?.data) ? response.item.error.data : {};

  return {
    ...response,
    item: {
      ...response.item,
      error: response.item.error
        ? {
            ...response.item.error,
            data: {
              ...currentData,
              retry_after_ms:
                typeof currentData.retry_after_ms === "number"
                  ? currentData.retry_after_ms
                  : retryAfterMs,
            },
          }
        : response.item.error,
    },
  };
};
