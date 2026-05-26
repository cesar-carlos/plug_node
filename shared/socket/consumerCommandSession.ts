import { randomUUID } from "node:crypto";

import {
  DEFAULT_API_VERSION,
  DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  DEFAULT_REQUEST_TIMEOUT_MS,
  SOCKET_PROTOCOL_VERSION,
  type BridgeCommand,
  type ConsumerCommandNotificationResponse,
  type ConsumerCommandSocketResponsePayload,
  type ConsumerCommandStreamChunkPayload,
  type ConsumerCommandStreamCompletePayload,
  type ConsumerCommandStreamPullResponsePayload,
  type JsonObject,
  type NormalizedAgentRpcResponse,
  type PayloadFrameCompression,
  type PlugCommandTransportResult,
  type PlugResponseMode,
  type PlugSession,
  type RelayConnectionReadyPayload,
  type RpcSingleCommand,
  type SocketCommandRuntimeMetrics,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";
import { estimateJsonUtf8Bytes, isRecord } from "../utils/json";
import { createSocketApplicationError, createSocketConnectError } from "./socketErrors";

const appErrorEvent = "app:error";
const connectErrorEvent = "connect_error";
const disconnectEvent = "disconnect";
const connectionReadyEvent = "connection:ready";
const commandEvent = "agents:command";
const commandResponseEvent = "agents:command_response";
const commandStreamChunkEvent = "agents:command_stream_chunk";
const commandStreamCompleteEvent = "agents:command_stream_complete";
const streamPullEvent = "agents:stream_pull";
const streamPullResponseEvent = "agents:stream_pull_response";
const defaultMaxBufferedChunkItems = 512;
const defaultMaxBufferedRows = 50_000;
const defaultMaxBufferedBytes = 8 * 1024 * 1024;
const maxStreamPullWindowSize = 1000;

export interface ConsumerSocketTransport {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface ExecuteConsumerCommandInput {
  readonly transport: ConsumerSocketTransport;
  readonly session: PlugSession;
  readonly agentId: string;
  readonly command: BridgeCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly responseMode: PlugResponseMode;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly bufferLimits?: {
    readonly maxBufferedChunkItems?: number;
    readonly maxBufferedRows?: number;
    readonly maxBufferedBytes?: number;
  };
  readonly streamPullWindowSize?: number;
}

const createConnectError = (payload: unknown): PlugError =>
  createSocketConnectError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
    retryDescription: "Run the node again to create a fresh socket connection.",
  });

const createSocketAppError = (payload: unknown): PlugError =>
  createSocketApplicationError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
  });

const normalizeStreamPullWindowSize = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(maxStreamPullWindowSize, Math.max(1, Math.floor(value)));
};

const createConsumerControlError = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
  readonly details?: Record<string, unknown>;
}): PlugError => {
  const code =
    typeof input.code === "string" && input.code.trim() !== ""
      ? input.code
      : "SOCKET_COMMAND_ERROR";

  if (code === "VALIDATION_ERROR" || input.statusCode === 400) {
    return new PlugError("Plug rejected the socket request payload.", {
      code,
      statusCode: input.statusCode,
      description: "Review the node fields and any advanced JSON before trying again.",
      details: input.details,
      technicalMessage: input.message,
    });
  }

  const retryAfterSeconds = normalizeRetryAfterSeconds(input);

  if (
    code === "RATE_LIMITED" ||
    code === "TOO_MANY_REQUESTS" ||
    input.statusCode === 429
  ) {
    return new PlugError("Plug rate limited the socket request.", {
      code,
      statusCode: input.statusCode,
      description:
        retryAfterSeconds !== undefined
          ? `Wait ${retryAfterSeconds} second(s) before trying this socket operation again.`
          : "Wait a moment before trying this socket operation again.",
      details: input.details,
      technicalMessage: input.message,
      retryable: true,
      retryAfterSeconds,
    });
  }

  if (input.statusCode === 503 || code === "SERVICE_UNAVAILABLE") {
    return new PlugError("Plug socket transport is temporarily unavailable.", {
      code,
      statusCode: input.statusCode,
      description:
        retryAfterSeconds !== undefined
          ? `The hub or agent may be overloaded. Try again in ${retryAfterSeconds} second(s).`
          : "The hub or agent may be overloaded. Try again shortly.",
      details: input.details,
      technicalMessage: input.message,
      retryable: true,
      retryAfterSeconds,
    });
  }

  if (input.statusCode === 404) {
    return new PlugError("The requested stream or agent route was not found.", {
      code,
      statusCode: input.statusCode,
      description: "Run the command again and confirm that the agent is still connected.",
      details: input.details,
      technicalMessage: input.message,
    });
  }

  return new PlugError(input.message ?? "Socket command request failed.", {
    code,
    statusCode: input.statusCode,
    details: input.details,
  });
};

const normalizeRetryAfterSeconds = (input: {
  readonly retryAfterMs?: number;
  readonly retryAfterSeconds?: number;
}): number | undefined => {
  if (
    typeof input.retryAfterSeconds === "number" &&
    Number.isFinite(input.retryAfterSeconds) &&
    input.retryAfterSeconds > 0
  ) {
    return Math.max(1, Math.ceil(input.retryAfterSeconds));
  }

  if (
    typeof input.retryAfterMs === "number" &&
    Number.isFinite(input.retryAfterMs) &&
    input.retryAfterMs > 0
  ) {
    return Math.max(1, Math.ceil(input.retryAfterMs / 1000));
  }

  return undefined;
};

const normalizeConnectionReady = (
  payload: unknown,
  signing?: PayloadFrameSigningOptions,
): Promise<RelayConnectionReadyPayload> =>
  decodePayloadFrameAsync<RelayConnectionReadyPayload>(payload, { signing }).then(
    (decoded) => decoded.data,
  );

const normalizeCommandResponse = (
  payload: unknown,
): ConsumerCommandSocketResponsePayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError("agents:command_response must be an object");
  }

  if (payload.success) {
    if (typeof payload.requestId !== "string" || payload.requestId.trim() === "") {
      throw new PlugValidationError(
        "agents:command_response success payload must include requestId",
      );
    }

    if (!("response" in payload)) {
      throw new PlugValidationError(
        "agents:command_response success payload must include response",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    typeof payload.error.code !== "string" ||
    typeof payload.error.message !== "string"
  ) {
    throw new PlugValidationError(
      "agents:command_response failure payload must include error.code and error.message",
    );
  }

  if (
    payload.clientRequestId !== undefined &&
    (typeof payload.clientRequestId !== "string" || payload.clientRequestId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_response clientRequestId must be a non-empty string",
    );
  }

  if (
    payload.requestId !== undefined &&
    (typeof payload.requestId !== "string" || payload.requestId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_response requestId must be a non-empty string",
    );
  }

  if (
    payload.streamId !== undefined &&
    (typeof payload.streamId !== "string" || payload.streamId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_response streamId must be a non-empty string",
    );
  }

  return payload as unknown as ConsumerCommandSocketResponsePayload;
};

const normalizeStreamChunkPayload = (
  payload: unknown,
): ConsumerCommandStreamChunkPayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("agents:command_stream_chunk must be an object");
  }

  if (
    payload.stream_id !== undefined &&
    (typeof payload.stream_id !== "string" || payload.stream_id.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_stream_chunk stream_id must be a non-empty string when present",
    );
  }

  return payload as ConsumerCommandStreamChunkPayload;
};

const normalizeStreamCompletePayload = (
  payload: unknown,
): ConsumerCommandStreamCompletePayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("agents:command_stream_complete must be an object");
  }

  if (
    payload.stream_id !== undefined &&
    (typeof payload.stream_id !== "string" || payload.stream_id.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_stream_complete stream_id must be a non-empty string when present",
    );
  }

  if (
    payload.terminal_status !== undefined &&
    typeof payload.terminal_status !== "string"
  ) {
    throw new PlugValidationError(
      "agents:command_stream_complete terminal_status must be a string when present",
    );
  }

  return payload as ConsumerCommandStreamCompletePayload;
};

const normalizeStreamPullResponse = (
  payload: unknown,
): ConsumerCommandStreamPullResponsePayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError("agents:stream_pull_response must be an object");
  }

  if (payload.success) {
    if (typeof payload.requestId !== "string" || payload.requestId.trim() === "") {
      throw new PlugValidationError(
        "agents:stream_pull_response success payload must include requestId",
      );
    }
    if (typeof payload.streamId !== "string" || payload.streamId.trim() === "") {
      throw new PlugValidationError(
        "agents:stream_pull_response success payload must include streamId",
      );
    }
    if (
      typeof payload.windowSize !== "number" ||
      !Number.isInteger(payload.windowSize) ||
      payload.windowSize <= 0
    ) {
      throw new PlugValidationError(
        "agents:stream_pull_response success payload must include a positive windowSize",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    typeof payload.error.code !== "string" ||
    typeof payload.error.message !== "string"
  ) {
    throw new PlugValidationError(
      "agents:stream_pull_response failure payload must include error.code and error.message",
    );
  }

  if (
    payload.requestId !== undefined &&
    (typeof payload.requestId !== "string" || payload.requestId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:stream_pull_response requestId must be a non-empty string",
    );
  }

  if (
    payload.streamId !== undefined &&
    (typeof payload.streamId !== "string" || payload.streamId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:stream_pull_response streamId must be a non-empty string",
    );
  }

  return payload as unknown as ConsumerCommandStreamPullResponsePayload;
};

const toRequestId = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

const resolveCommandRequestId = (command: BridgeCommand): string => {
  if (Array.isArray(command)) {
    return randomUUID();
  }

  return toRequestId(command.id) ?? randomUUID();
};

const withCommandRequestId = (
  command: BridgeCommand,
  requestId: string,
): BridgeCommand => {
  if (Array.isArray(command) || command.id !== undefined) {
    return command;
  }

  return {
    ...command,
    id: requestId,
  } as RpcSingleCommand;
};

const isNotificationResponse = (
  value: unknown,
): value is ConsumerCommandNotificationResponse =>
  isRecord(value) &&
  value.type === "notification" &&
  typeof value.accepted === "boolean" &&
  typeof value.acceptedCommands === "number";

const createDisconnectError = (reason: unknown): PlugError =>
  new PlugError("The Plug socket disconnected before the command finished.", {
    code: "SOCKET_DISCONNECTED",
    description: "Run the node again to open a new socket connection.",
    technicalMessage: typeof reason === "string" ? reason : undefined,
    retryable: true,
  });

const countRows = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const isSingleSuccessWithRows = (
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

const tryMergeChunkRowsIntoNormalizedResponse = (
  response: NormalizedAgentRpcResponse | undefined,
  chunk: JsonObject,
): NormalizedAgentRpcResponse | undefined => {
  if (!response || !isSingleSuccessWithRows(response) || !Array.isArray(chunk.rows)) {
    return undefined;
  }

  return {
    ...response,
    item: {
      ...response.item,
      result: {
        ...response.item.result,
        rows: [...response.item.result.rows, ...chunk.rows],
      },
    },
  } as NormalizedAgentRpcResponse;
};

const removeStreamMarkerFromResponse = (
  response: NormalizedAgentRpcResponse | undefined,
): NormalizedAgentRpcResponse | undefined => {
  if (!response || !isSingleSuccessWithRows(response)) {
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

const attachRetryAfterToNormalizedResponse = (
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

const buildSocketBufferError = (details: {
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

const buildCapabilityProbeCommand = (): RpcSingleCommand => ({
  jsonrpc: "2.0",
  method: "rpc.discover",
  id: null,
  api_version: DEFAULT_API_VERSION,
});

const waitForConnectionReady = async (
  transport: ConsumerSocketTransport,
  timeoutMs: number,
  signing?: PayloadFrameSigningOptions,
): Promise<RelayConnectionReadyPayload | undefined> => {
  if (transport.connected) {
    return undefined;
  }

  return new Promise<RelayConnectionReadyPayload>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(connectionReadyEvent, handleReady);
      transport.off(appErrorEvent, handleAppError);
      transport.off(connectErrorEvent, handleConnectError);
      transport.off(disconnectEvent, handleDisconnect);
    };

    const handleReady = (payload: unknown): void => {
      cleanup();
      void normalizeConnectionReady(payload, signing).then(resolve, reject);
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError("Timed out while waiting for socket connection:ready", {
          timeoutMs,
          eventName: connectionReadyEvent,
        }),
      );
    }, timeoutMs);

    transport.on(connectionReadyEvent, handleReady);
    transport.on(appErrorEvent, handleAppError);
    transport.on(connectErrorEvent, handleConnectError);
    transport.on(disconnectEvent, handleDisconnect);
    transport.connect();
  });
};

const matchesCommandRequest = (
  payload: {
    readonly requestId?: string;
    readonly clientRequestId?: string;
  },
  requestId: string,
): boolean => payload.requestId === requestId || payload.clientRequestId === requestId;

const matchesStreamPullResponse = (
  response: ConsumerCommandStreamPullResponsePayload,
  requestId: string,
  streamId: string,
): boolean => {
  if (response.success) {
    return response.requestId === requestId && response.streamId === streamId;
  }

  if (response.requestId !== undefined && response.requestId !== requestId) {
    return false;
  }

  if (response.streamId !== undefined && response.streamId !== streamId) {
    return false;
  }

  // When the failure response carries no identifiers, treat it as matching
  // this request so the error is surfaced immediately instead of timing out.
  if (response.requestId === undefined && response.streamId === undefined) {
    return true;
  }

  return response.requestId === requestId || response.streamId === streamId;
};

const matchesStreamPayload = (
  payload: JsonObject,
  activeRequestId: string,
  commandRequestId: string,
  activeStreamId: string | undefined,
): boolean => {
  const requestId = toRequestId(payload.request_id);
  if (requestId !== activeRequestId && requestId !== commandRequestId) {
    return false;
  }

  return (
    activeStreamId === undefined ||
    typeof payload.stream_id !== "string" ||
    payload.stream_id === activeStreamId
  );
};

const requestStreamPull = async (
  transport: ConsumerSocketTransport,
  requestId: string,
  streamId: string,
  timeoutMs: number,
  windowSize = DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  onIgnoredResponse?: (payload: ConsumerCommandStreamPullResponsePayload) => void,
): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const normalizedWindowSize = normalizeStreamPullWindowSize(
      windowSize,
      DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
    );
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(streamPullResponseEvent, handlePullResponse);
      transport.off(appErrorEvent, handleAppError);
      transport.off(connectErrorEvent, handleConnectError);
      transport.off(disconnectEvent, handleDisconnect);
    };

    const handlePullResponse = (payload: unknown): void => {
      try {
        const response = normalizeStreamPullResponse(payload);
        if (!matchesStreamPullResponse(response, requestId, streamId)) {
          onIgnoredResponse?.(response);
          return;
        }

        if (!response.success) {
          cleanup();
          reject(
            createConsumerControlError({
              code: response.error.code,
              message: response.error.message,
              statusCode: response.error.statusCode,
              retryAfterMs: response.error.retryAfterMs,
              details: response.rateLimit ? { rateLimit: response.rateLimit } : undefined,
            }),
          );
          return;
        }

        cleanup();
        resolve(normalizeStreamPullWindowSize(response.windowSize, normalizedWindowSize));
      } catch (error: unknown) {
        cleanup();
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError("Timed out while waiting for agents:stream_pull_response", {
          timeoutMs,
          eventName: streamPullResponseEvent,
          requestId,
          streamId,
        }),
      );
    }, timeoutMs);

    transport.on(streamPullResponseEvent, handlePullResponse);
    transport.on(appErrorEvent, handleAppError);
    transport.on(connectErrorEvent, handleConnectError);
    transport.on(disconnectEvent, handleDisconnect);
    transport.emit(streamPullEvent, {
      requestId,
      streamId,
      windowSize: normalizedWindowSize,
    });
  });

export const executeConsumerCommand = async (
  input: ExecuteConsumerCommandInput,
): Promise<PlugCommandTransportResult> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const limits = {
    maxBufferedChunkItems:
      input.bufferLimits?.maxBufferedChunkItems ?? defaultMaxBufferedChunkItems,
    maxBufferedRows: input.bufferLimits?.maxBufferedRows ?? defaultMaxBufferedRows,
    maxBufferedBytes: input.bufferLimits?.maxBufferedBytes ?? defaultMaxBufferedBytes,
  };
  const commandStartMs = Date.now();
  const commandRequestId = resolveCommandRequestId(input.command);
  const command = withCommandRequestId(input.command, commandRequestId);
  const connectionReady = await waitForConnectionReady(
    input.transport,
    timeoutMs,
    input.payloadFrameSigning,
  );
  const connectedAfterMs = Date.now() - commandStartMs;

  plugLogger.debug("transport.socket.command.request", {
    agentId: input.agentId,
    method: Array.isArray(input.command) ? "batch" : input.command.method,
    timeoutMs,
    responseMode: input.responseMode,
    connectedAfterMs,
  });

  return new Promise<PlugCommandTransportResult>((resolve, reject) => {
    const chunkPayloads: JsonObject[] = [];
    let activeRequestId = commandRequestId;
    let activeStreamId: string | undefined;
    let rawResponsePayload: unknown;
    let normalizedResponse: NormalizedAgentRpcResponse | undefined;
    let completePayload: JsonObject | undefined;
    let streamCreditsRemaining = 0;
    let streamPullInFlight = false;
    let pendingChunksDuringPull = 0;
    let streamCompleted = false;
    let pullCount = 0;
    let chunkCount = 0;
    let bufferedBytes = 0;
    let bufferedRows = 0;
    let ignoredCommandResponses = 0;
    let ignoredStreamChunks = 0;
    let ignoredStreamCompletes = 0;
    let ignoredStreamPullResponses = 0;

    const buildMetrics = (): SocketCommandRuntimeMetrics => ({
      ignoredCommandResponses,
      ignoredStreamChunks,
      ignoredStreamCompletes,
      ignoredStreamPullResponses,
      streamPullRequests: pullCount,
      streamChunks: chunkCount,
      bufferedBytes,
      bufferedRows,
    });

    const assertBufferLimits = (): void => {
      if (
        bufferedBytes > limits.maxBufferedBytes ||
        bufferedRows > limits.maxBufferedRows ||
        chunkCount > limits.maxBufferedChunkItems
      ) {
        throw buildSocketBufferError({
          ...limits,
          bufferedBytes,
          bufferedRows,
          chunkCount,
        });
      }
    };

    const cleanup = (): void => {
      clearTimeout(timer);
      input.transport.off(commandResponseEvent, handleCommandResponse);
      input.transport.off(commandStreamChunkEvent, handleCommandStreamChunk);
      input.transport.off(commandStreamCompleteEvent, handleCommandStreamComplete);
      input.transport.off(appErrorEvent, handleAppError);
      input.transport.off(connectErrorEvent, handleConnectError);
      input.transport.off(disconnectEvent, handleDisconnect);
    };

    const resolveNotification = (
      requestId: string,
      response: ConsumerCommandNotificationResponse,
    ): void => {
      cleanup();
      plugLogger.info("transport.socket.command.notification", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId,
        durationMs: Date.now() - commandStartMs,
      });
      resolve({
        channel: "socket",
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId,
        notification: true,
        acceptedCommands: response.acceptedCommands,
        ...(connectionReady ? { connectionReady } : {}),
        metrics: buildMetrics(),
      });
    };

    const requestNextStreamWindow = async (): Promise<void> => {
      if (!activeStreamId || streamPullInFlight || streamCompleted) {
        return;
      }

      streamPullInFlight = true;
      pullCount += 1;
      try {
        const nextWindowSize = await requestStreamPull(
          input.transport,
          activeRequestId,
          activeStreamId,
          timeoutMs,
          input.streamPullWindowSize ?? DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
          (payload) => {
            ignoredStreamPullResponses += 1;
            plugLogger.debug("transport.socket.command.stream_pull_ignored", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              expectedRequestId: activeRequestId,
              expectedStreamId: activeStreamId,
              requestId: payload.requestId,
              streamId: payload.streamId,
            });
          },
        );
        streamCreditsRemaining = Math.max(nextWindowSize - pendingChunksDuringPull, 0);
        pendingChunksDuringPull = 0;
      } finally {
        streamPullInFlight = false;
      }

      if (activeStreamId && streamCreditsRemaining === 0 && !streamCompleted) {
        await requestNextStreamWindow();
      }
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError("Timed out while waiting for agents:command completion", {
          timeoutMs,
          eventName: commandResponseEvent,
          requestId: activeRequestId,
          streamId: activeStreamId,
          socketMode: "agentsCommand",
        }),
      );
    }, timeoutMs);

    const handleCommandResponse = (payload: unknown): void => {
      void (async () => {
        try {
          const response = normalizeCommandResponse(payload);
          if (!matchesCommandRequest(response, commandRequestId)) {
            ignoredCommandResponses += 1;
            plugLogger.debug("transport.socket.command.response_ignored", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              expectedRequestId: commandRequestId,
              requestId: response.requestId,
              clientRequestId: response.clientRequestId,
              streamId: response.streamId,
            });
            return;
          }

          if (!response.success) {
            cleanup();
            reject(
              createConsumerControlError({
                code: response.error.code,
                message: response.error.message,
                statusCode: response.error.statusCode,
                retryAfterMs: response.error.retryAfterMs,
              }),
            );
            return;
          }

          activeRequestId = response.requestId;
          rawResponsePayload = response.response;
          normalizedResponse =
            !isNotificationResponse(response.response) &&
            isRecord(response.response) &&
            typeof response.response.type === "string"
              ? (response.response as NormalizedAgentRpcResponse)
              : undefined;
          normalizedResponse = attachRetryAfterToNormalizedResponse(
            normalizedResponse,
            response.retryAfterSeconds,
          );
          bufferedBytes += estimateJsonUtf8Bytes(response.response);

          if (isSingleSuccessWithRows(response.response)) {
            bufferedRows += countRows(response.response.item.result.rows);
          }
          assertBufferLimits();

          if (isNotificationResponse(response.response)) {
            resolveNotification(response.requestId, response.response);
            return;
          }

          activeStreamId =
            typeof response.streamId === "string" && response.streamId.trim() !== ""
              ? response.streamId
              : undefined;

          if (!activeStreamId) {
            cleanup();
            plugLogger.info("transport.socket.command.complete", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              requestId: response.requestId,
              durationMs: Date.now() - commandStartMs,
              chunkCount,
              pullCount,
              bufferedBytes,
              bufferedRows,
              retryAfterSeconds: response.retryAfterSeconds,
            });
            resolve({
              channel: "socket",
              socketMode: "agentsCommand",
              agentId: input.agentId,
              requestId: response.requestId,
              notification: false,
              ...(connectionReady ? { connectionReady } : {}),
              response: normalizedResponse ?? response.response,
              rawResponsePayload: response.response,
              chunkPayloads,
              rawChunkFrames: [],
              metrics: buildMetrics(),
            });
            return;
          }

          await requestNextStreamWindow();
        } catch (error: unknown) {
          cleanup();
          reject(error);
        }
      })();
    };

    const handleCommandStreamChunk = (payload: unknown): void => {
      void (async () => {
        try {
          const chunk = normalizeStreamChunkPayload(payload);
          if (
            !matchesStreamPayload(
              chunk,
              activeRequestId,
              commandRequestId,
              activeStreamId,
            )
          ) {
            ignoredStreamChunks += 1;
            plugLogger.debug("transport.socket.command.stream_chunk_ignored", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              expectedRequestId: activeRequestId,
              commandRequestId,
              expectedStreamId: activeStreamId,
              requestId: toRequestId(chunk.request_id),
              streamId: typeof chunk.stream_id === "string" ? chunk.stream_id : undefined,
            });
            return;
          }

          chunkPayloads.push(chunk);
          chunkCount += 1;
          bufferedBytes += estimateJsonUtf8Bytes(chunk);
          bufferedRows += countRows(chunk.rows);

          if (input.responseMode === "aggregatedJson") {
            const mergedResponse = tryMergeChunkRowsIntoNormalizedResponse(
              normalizedResponse,
              chunk,
            );
            if (mergedResponse !== undefined) {
              normalizedResponse = mergedResponse;
              chunkPayloads.pop();
            }
          }

          assertBufferLimits();

          if (activeStreamId && streamPullInFlight) {
            pendingChunksDuringPull += 1;
          } else if (activeStreamId && streamCreditsRemaining > 0) {
            streamCreditsRemaining -= 1;
          }

          if (activeStreamId && streamCreditsRemaining === 0) {
            await requestNextStreamWindow();
          }
        } catch (error: unknown) {
          cleanup();
          reject(error);
        }
      })();
    };

    const handleCommandStreamComplete = (payload: unknown): void => {
      try {
        const complete = normalizeStreamCompletePayload(payload);
        if (
          !matchesStreamPayload(
            complete,
            activeRequestId,
            commandRequestId,
            activeStreamId,
          )
        ) {
          ignoredStreamCompletes += 1;
          plugLogger.debug("transport.socket.command.stream_complete_ignored", {
            socketMode: "agentsCommand",
            agentId: input.agentId,
            expectedRequestId: activeRequestId,
            commandRequestId,
            expectedStreamId: activeStreamId,
            requestId: toRequestId(complete.request_id),
            streamId:
              typeof complete.stream_id === "string" ? complete.stream_id : undefined,
          });
          return;
        }

        streamCompleted = true;
        completePayload = complete;
        if (input.responseMode === "aggregatedJson") {
          normalizedResponse = removeStreamMarkerFromResponse(normalizedResponse);
        }
        cleanup();
        plugLogger.info("transport.socket.command.complete", {
          socketMode: "agentsCommand",
          agentId: input.agentId,
          requestId: activeRequestId,
          durationMs: Date.now() - commandStartMs,
          chunkCount,
          pullCount,
          bufferedBytes,
          bufferedRows,
        });
        resolve({
          channel: "socket",
          socketMode: "agentsCommand",
          agentId: input.agentId,
          requestId: activeRequestId,
          notification: false,
          ...(connectionReady ? { connectionReady } : {}),
          response:
            input.responseMode === "aggregatedJson" && normalizedResponse
              ? normalizedResponse
              : (rawResponsePayload as NormalizedAgentRpcResponse),
          rawResponsePayload,
          chunkPayloads,
          completePayload,
          rawChunkFrames: [],
          metrics: buildMetrics(),
        });
      } catch (error: unknown) {
        cleanup();
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      plugLogger.warn("transport.socket.command.app_error", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: activeRequestId,
        durationMs: Date.now() - commandStartMs,
      });
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      plugLogger.warn("transport.socket.command.connect_error", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: activeRequestId,
        durationMs: Date.now() - commandStartMs,
      });
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      plugLogger.warn("transport.socket.command.disconnected", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: activeRequestId,
        durationMs: Date.now() - commandStartMs,
      });
      reject(createDisconnectError(payload));
    };

    input.transport.on(commandResponseEvent, handleCommandResponse);
    input.transport.on(commandStreamChunkEvent, handleCommandStreamChunk);
    input.transport.on(commandStreamCompleteEvent, handleCommandStreamComplete);
    input.transport.on(appErrorEvent, handleAppError);
    input.transport.on(connectErrorEvent, handleConnectError);
    input.transport.on(disconnectEvent, handleDisconnect);
    input.transport.emit(commandEvent, {
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      requestId: commandRequestId,
      clientRequestId: commandRequestId,
      agentId: input.agentId,
      command,
      timeoutMs,
      payloadFrameCompression: input.payloadFrameCompression ?? "default",
    });
  });
};

export const buildConsumerSocketCapabilityProbeCommand = buildCapabilityProbeCommand;
