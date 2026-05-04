import {
  DEFAULT_API_VERSION,
  DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  DEFAULT_REQUEST_TIMEOUT_MS,
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
} from "../contracts/api";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { decodePayloadFrame } from "./payloadFrameCodec";
import { estimateJsonUtf8Bytes, isRecord } from "../utils/json";

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
  readonly bufferLimits?: {
    readonly maxBufferedChunkItems?: number;
    readonly maxBufferedRows?: number;
    readonly maxBufferedBytes?: number;
  };
}

const createSocketAppError = (payload: unknown): PlugError => {
  const appError = isRecord(payload) ? payload : {};
  const code =
    typeof appError.code === "string" && appError.code.trim() !== ""
      ? appError.code
      : "SOCKET_APP_ERROR";
  const details = isRecord(appError.details) ? appError.details : undefined;

  if (code === "ACCOUNT_BLOCKED") {
    return new PlugError("The Plug account is blocked.", {
      code,
      description:
        "The server closed the socket because the user or client account is blocked.",
      details,
      technicalMessage:
        typeof appError.message === "string" ? appError.message : undefined,
      authRelated: true,
    });
  }

  if (code === "AGENT_ACCESS_REVOKED") {
    return new PlugError("Client access to this agent was revoked.", {
      code,
      description:
        "Ask the agent owner to approve access again or update the credential before retrying.",
      details,
      technicalMessage:
        typeof appError.message === "string" ? appError.message : undefined,
      authRelated: true,
    });
  }

  return new PlugError(
    typeof appError.message === "string" && appError.message.trim() !== ""
      ? appError.message
      : "Plug socket reported an application error.",
    {
      code,
      details,
    },
  );
};

const createConsumerControlError = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
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
      technicalMessage: input.message,
    });
  }

  if (
    code === "RATE_LIMITED" ||
    code === "TOO_MANY_REQUESTS" ||
    input.statusCode === 429
  ) {
    return new PlugError("Plug rate limited the socket request.", {
      code,
      statusCode: input.statusCode,
      description: "Wait a moment before trying this socket operation again.",
      technicalMessage: input.message,
      retryable: true,
    });
  }

  if (input.statusCode === 503) {
    return new PlugError("Plug socket transport is temporarily unavailable.", {
      code,
      statusCode: input.statusCode,
      description: "The hub or agent may be overloaded. Try again shortly.",
      technicalMessage: input.message,
      retryable: true,
    });
  }

  if (input.statusCode === 404) {
    return new PlugError("The requested stream or agent route was not found.", {
      code,
      statusCode: input.statusCode,
      description: "Run the command again and confirm that the agent is still connected.",
      technicalMessage: input.message,
    });
  }

  return new PlugError(input.message ?? "Socket command request failed.", {
    code,
    statusCode: input.statusCode,
  });
};

const normalizeConnectionReady = (payload: unknown): RelayConnectionReadyPayload =>
  decodePayloadFrame<RelayConnectionReadyPayload>(payload).data;

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

  return payload as unknown as ConsumerCommandSocketResponsePayload;
};

const normalizeStreamChunkPayload = (
  payload: unknown,
): ConsumerCommandStreamChunkPayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("agents:command_stream_chunk must be an object");
  }

  return payload as ConsumerCommandStreamChunkPayload;
};

const normalizeStreamCompletePayload = (
  payload: unknown,
): ConsumerCommandStreamCompletePayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("agents:command_stream_complete must be an object");
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

const appendChunkRowsToResponse = (
  response: NormalizedAgentRpcResponse | undefined,
  chunk: JsonObject,
): boolean => {
  if (!response || !isSingleSuccessWithRows(response) || !Array.isArray(chunk.rows)) {
    return false;
  }

  response.item.result.rows.push(...chunk.rows);
  return true;
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
      try {
        resolve(normalizeConnectionReady(payload));
      } catch (error: unknown) {
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      const message =
        payload instanceof Error
          ? payload.message
          : typeof payload === "string"
            ? payload
            : "Socket connection failed";
      reject(
        new PlugError("Failed to connect to the Plug socket.", {
          code: "SOCKET_CONNECT_ERROR",
          description: "Run the node again to create a fresh socket connection.",
          technicalMessage: message,
          retryable: true,
        }),
      );
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

const requestStreamPull = async (
  transport: ConsumerSocketTransport,
  requestId: string,
  streamId: string,
  timeoutMs: number,
  windowSize = DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
): Promise<number> =>
  new Promise<number>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(streamPullResponseEvent, handlePullResponse);
      transport.off(appErrorEvent, handleAppError);
      transport.off(disconnectEvent, handleDisconnect);
    };

    const handlePullResponse = (payload: unknown): void => {
      try {
        const response = normalizeStreamPullResponse(payload);
        if (!response.success) {
          cleanup();
          reject(
            createConsumerControlError({
              code: response.error.code,
              message: response.error.message,
              statusCode: response.error.statusCode,
            }),
          );
          return;
        }

        if (response.requestId !== requestId || response.streamId !== streamId) {
          return;
        }

        cleanup();
        resolve(response.windowSize);
      } catch (error: unknown) {
        cleanup();
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
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
    transport.on(disconnectEvent, handleDisconnect);
    transport.emit(streamPullEvent, {
      requestId,
      streamId,
      windowSize,
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
  const connectionReady = await waitForConnectionReady(input.transport, timeoutMs);
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
    let activeRequestId: string | undefined;
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

    const cleanup = (): void => {
      clearTimeout(timer);
      input.transport.off(commandResponseEvent, handleCommandResponse);
      input.transport.off(commandStreamChunkEvent, handleCommandStreamChunk);
      input.transport.off(commandStreamCompleteEvent, handleCommandStreamComplete);
      input.transport.off(appErrorEvent, handleAppError);
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
      });
    };

    const requestNextStreamWindow = async (): Promise<void> => {
      if (!activeRequestId || !activeStreamId || streamPullInFlight || streamCompleted) {
        return;
      }

      streamPullInFlight = true;
      try {
        const nextWindowSize = await requestStreamPull(
          input.transport,
          activeRequestId,
          activeStreamId,
          timeoutMs,
        );
        pullCount += 1;
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
          if (!response.success) {
            cleanup();
            reject(
              createConsumerControlError({
                code: response.error.code,
                message: response.error.message,
                statusCode: response.error.statusCode,
              }),
            );
            return;
          }

          if (activeRequestId && response.requestId !== activeRequestId) {
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
          bufferedBytes += estimateJsonUtf8Bytes(response.response);

          if (isSingleSuccessWithRows(response.response)) {
            bufferedRows += countRows(response.response.item.result.rows);
          }

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
            });
            resolve({
              channel: "socket",
              socketMode: "agentsCommand",
              agentId: input.agentId,
              requestId: response.requestId,
              notification: false,
              ...(connectionReady ? { connectionReady } : {}),
              response: response.response,
              rawResponsePayload: response.response,
              chunkPayloads,
              rawChunkFrames: [],
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
          if (!activeRequestId) {
            return;
          }

          const requestId = toRequestId(chunk.request_id);
          if (activeRequestId && requestId && requestId !== activeRequestId) {
            return;
          }

          chunkPayloads.push(chunk);
          chunkCount += 1;
          bufferedBytes += estimateJsonUtf8Bytes(chunk);
          bufferedRows += countRows(chunk.rows);

          const foldedIntoResponse =
            input.responseMode === "aggregatedJson" &&
            appendChunkRowsToResponse(normalizedResponse, chunk);

          if (foldedIntoResponse) {
            chunkPayloads.pop();
          }

          if (
            bufferedBytes > limits.maxBufferedBytes ||
            bufferedRows > limits.maxBufferedRows ||
            chunkPayloads.length > limits.maxBufferedChunkItems
          ) {
            throw buildSocketBufferError({
              ...limits,
              bufferedBytes,
              bufferedRows,
              chunkCount,
            });
          }

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
        if (!activeRequestId) {
          return;
        }

        const requestId = toRequestId(complete.request_id);
        if (activeRequestId && requestId && requestId !== activeRequestId) {
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
          requestId: activeRequestId ?? requestId ?? "unknown-request",
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
          requestId: activeRequestId ?? requestId ?? "unknown-request",
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
    input.transport.on(disconnectEvent, handleDisconnect);
    input.transport.emit(commandEvent, {
      agentId: input.agentId,
      command: input.command,
      timeoutMs,
      payloadFrameCompression: input.payloadFrameCompression ?? "default",
    });
  });
};

export const buildConsumerSocketCapabilityProbeCommand = buildCapabilityProbeCommand;
