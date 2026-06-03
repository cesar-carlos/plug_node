import type { JsonObject } from "../contracts/api";
import { PlugError } from "../contracts/errors";
import { isRecord } from "../utils/json";

export const defaultMaxBufferedChunkItems = 512;
export const defaultMaxBufferedRows = 50_000;
export const defaultMaxBufferedBytes = 8 * 1024 * 1024;

export interface SocketBufferLimits {
  readonly maxBufferedChunkItems: number;
  readonly maxBufferedRows: number;
  readonly maxBufferedBytes: number;
}

export interface SocketBufferState {
  readonly bufferedBytes: number;
  readonly bufferedRows: number;
  readonly chunkCount: number;
}

export const resolveSocketBufferLimits = (
  input?: Partial<SocketBufferLimits>,
): SocketBufferLimits => ({
  maxBufferedChunkItems: input?.maxBufferedChunkItems ?? defaultMaxBufferedChunkItems,
  maxBufferedRows: input?.maxBufferedRows ?? defaultMaxBufferedRows,
  maxBufferedBytes: input?.maxBufferedBytes ?? defaultMaxBufferedBytes,
});

export const countRows = (value: unknown): number =>
  Array.isArray(value) ? value.length : 0;

export const countResultRows = (payload: unknown): number => {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    return 0;
  }

  return countRows(payload.result.rows);
};

export const buildSocketBufferError = (details: {
  readonly maxBufferedBytes: number;
  readonly maxBufferedRows: number;
  readonly maxBufferedChunkItems: number;
  readonly bufferedBytes: number;
  readonly bufferedRows: number;
  readonly chunkCount: number;
}): PlugError =>
  new PlugError("The socket response exceeded the local buffer safety limits.", {
    code: "SOCKET_BUFFER_LIMIT",
    description:
      "Reduce Max Rows, paginate the query, or split the workflow into smaller requests before trying again.",
    details,
  });

export const assertSocketBufferWithinLimits = (
  limits: SocketBufferLimits,
  state: SocketBufferState,
): void => {
  if (
    state.bufferedBytes > limits.maxBufferedBytes ||
    state.bufferedRows > limits.maxBufferedRows ||
    state.chunkCount > limits.maxBufferedChunkItems
  ) {
    throw buildSocketBufferError({
      ...limits,
      ...state,
    });
  }
};

const isRpcSuccessWithRows = (
  payload: unknown,
): payload is {
  readonly result: {
    readonly rows: unknown[];
    readonly stream_id?: string;
    readonly [key: string]: unknown;
  };
  readonly [key: string]: unknown;
} => isRecord(payload) && isRecord(payload.result) && Array.isArray(payload.result.rows);

export const tryMergeChunkRowsIntoRawRpcResponse = (
  response: unknown,
  chunk: JsonObject,
): unknown | undefined => {
  if (
    !isRpcSuccessWithRows(response) ||
    !Array.isArray(chunk.rows) ||
    chunk.rows.length === 0
  ) {
    return undefined;
  }

  const targetRows = response.result.rows;
  for (const row of chunk.rows) {
    targetRows.push(row);
  }

  return response;
};

export const removeStreamMarkerFromRawRpcResponse = (response: unknown): unknown => {
  if (!isRpcSuccessWithRows(response)) {
    return response;
  }

  const { stream_id: streamId, ...resultWithoutStreamId } = response.result;
  void streamId;
  return {
    ...response,
    result: {
      ...resultWithoutStreamId,
      rows: response.result.rows,
    },
  };
};
