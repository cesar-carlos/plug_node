import { randomUUID } from "node:crypto";

import {
  DEFAULT_RELAY_PULL_WINDOW,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type JsonObject,
  type PayloadFrameCompression,
  type PlugCommandTransportResult,
  type PlugResponseMode,
  type PlugSession,
  type RelayConnectionReadyPayload,
  type RelayConversationStartedPayload,
  type RelayRpcAcceptedPayload,
  type RelayRpcAcceptedSuccessPayload,
  type RelayStreamPullResponsePayload,
  type RpcSingleCommand,
} from "../contracts/api";
import type {
  PayloadFrameEnvelope,
  PayloadFrameSigningOptions,
} from "../contracts/payload-frame";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { normalizeRpcPayload } from "../output/rpcNormalization";
import { decodePayloadFrameAsync, encodePayloadFrameAsync } from "./payloadFrameCodec";
import { isRecord } from "../utils/json";
import { createSocketApplicationError, createSocketConnectError } from "./socketErrors";

const appErrorEvent = "app:error";
const connectErrorEvent = "connect_error";
const disconnectEvent = "disconnect";
const connectionReadyEvent = "connection:ready";
const conversationStartEvent = "relay:conversation.start";
const conversationStartedEvent = "relay:conversation.started";
const conversationEndEvent = "relay:conversation.end";
const rpcRequestEvent = "relay:rpc.request";
const rpcAcceptedEvent = "relay:rpc.accepted";
const rpcResponseEvent = "relay:rpc.response";
const rpcChunkEvent = "relay:rpc.chunk";
const rpcCompleteEvent = "relay:rpc.complete";
const rpcStreamPullEvent = "relay:rpc.stream.pull";
const rpcStreamPullResponseEvent = "relay:rpc.stream.pull_response";
const defaultMaxBufferedChunkItems = 512;
const defaultMaxBufferedRows = 50_000;
const defaultMaxBufferedBytes = 8 * 1024 * 1024;
const maxStreamPullWindowSize = 1000;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value > 0;

const normalizeStreamPullWindowSize = (value: unknown, fallback: number): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(maxStreamPullWindowSize, Math.max(1, Math.floor(value)));
};

const createSocketAppError = (payload: unknown): PlugError =>
  createSocketApplicationError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
  });

const createRelayControlError = (input: {
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
      : "RELAY_ERROR";

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

  if (code === "RATE_LIMITED" || input.statusCode === 429) {
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

  return new PlugError(input.message ?? "Socket relay request failed.", {
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

const createDisconnectError = (reason: unknown): PlugError =>
  new PlugError("The Plug socket disconnected before the relay command finished.", {
    code: "SOCKET_DISCONNECTED",
    description: "Run the node again to open a new socket connection.",
    technicalMessage: typeof reason === "string" ? reason : undefined,
    retryable: true,
  });

const createConnectError = (payload: unknown): PlugError =>
  createSocketConnectError(payload, {
    refreshDescription:
      "The Plug session will be refreshed before retrying the socket operation.",
    retryDescription: "Run the node again to create a fresh socket connection.",
  });

export interface RelaySocketTransport {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface ExecuteRelayCommandInput {
  readonly transport: RelaySocketTransport;
  readonly session: PlugSession;
  readonly agentId: string;
  readonly command: RpcSingleCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly responseMode: PlugResponseMode;
  readonly bufferLimits?: {
    readonly maxBufferedChunkItems?: number;
    readonly maxBufferedRows?: number;
    readonly maxBufferedBytes?: number;
  };
  readonly streamPullWindowSize?: number;
}

const waitForSingleEvent = <TPayload>(
  transport: RelaySocketTransport,
  eventName: string,
  timeoutMs: number,
  parser: (payload: unknown) => TPayload | Promise<TPayload>,
): Promise<TPayload> =>
  new Promise<TPayload>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(eventName, handlePayload);
      transport.off(appErrorEvent, handleAppError);
      transport.off(connectErrorEvent, handleConnectError);
      transport.off(disconnectEvent, handleDisconnect);
    };

    const handlePayload = (payload: unknown): void => {
      cleanup();
      try {
        void Promise.resolve(parser(payload)).then(resolve, reject);
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
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError(`Timed out while waiting for socket event ${eventName}`, {
          timeoutMs,
          eventName,
        }),
      );
    }, timeoutMs);

    transport.on(eventName, handlePayload);
    transport.on(appErrorEvent, handleAppError);
    transport.on(connectErrorEvent, handleConnectError);
    transport.on(disconnectEvent, handleDisconnect);
  });

const normalizeConnectionReady = (
  payload: unknown,
  signing?: PayloadFrameSigningOptions,
): Promise<RelayConnectionReadyPayload> =>
  decodePayloadFrameAsync<RelayConnectionReadyPayload>(payload, { signing }).then(
    (decoded) => decoded.data,
  );

const normalizeConversationStarted = (
  payload: unknown,
): RelayConversationStartedPayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError(
      "relay:conversation.started must be an object with a success boolean",
    );
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:conversation.started success payload must include conversationId",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:conversation.started failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayConversationStartedPayload;
};

const normalizeAcceptedPayload = (payload: unknown): RelayRpcAcceptedPayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError("relay:rpc.accepted must include success boolean");
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:rpc.accepted success payload must include conversationId",
      );
    }
    if (!isNonEmptyString(payload.requestId)) {
      throw new PlugValidationError(
        "relay:rpc.accepted success payload must include requestId",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:rpc.accepted failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayRpcAcceptedPayload;
};

const normalizeStreamPullResponse = (
  payload: unknown,
): RelayStreamPullResponsePayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError(
      "relay:rpc.stream.pull_response must include success boolean",
    );
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include conversationId",
      );
    }
    if (!isNonEmptyString(payload.requestId)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include requestId",
      );
    }
    if (!isNonEmptyString(payload.streamId)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include streamId",
      );
    }
    if (!isPositiveInteger(payload.windowSize)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include a positive windowSize",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:rpc.stream.pull_response failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayStreamPullResponsePayload;
};

const assertAcceptedPayload = (
  payload: RelayRpcAcceptedPayload,
): RelayRpcAcceptedSuccessPayload => {
  if (payload.success) {
    return payload;
  }

  throw createRelayControlError({
    code: payload.error.code,
    message: payload.error.message,
    statusCode: payload.error.statusCode,
    retryAfterMs: payload.error.retryAfterMs,
  });
};

const ensureRelayCompatibleCommand = (command: RpcSingleCommand): RpcSingleCommand => {
  if (command.id === null) {
    throw new PlugValidationError(
      "Socket relay does not support JSON-RPC notifications (`id: null`)",
    );
  }

  return {
    ...command,
    id: command.id ?? randomUUID(),
  };
};

const countRows = (value: unknown): number => (Array.isArray(value) ? value.length : 0);

const countResultRows = (payload: unknown): number => {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    return 0;
  }

  return countRows(payload.result.rows);
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

const tryMergeChunkRowsIntoResponse = (
  response: unknown,
  chunk: JsonObject,
): unknown | undefined => {
  if (!isRpcSuccessWithRows(response) || !Array.isArray(chunk.rows)) {
    return undefined;
  }

  return {
    ...response,
    result: {
      ...response.result,
      rows: [...response.result.rows, ...chunk.rows],
    },
  };
};

const removeStreamMarkerFromResponse = (response: unknown): unknown => {
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

const getStreamIdFromNormalizedResponse = (payload: unknown): string | undefined => {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    return undefined;
  }

  return typeof payload.result.stream_id === "string" &&
    payload.result.stream_id.trim() !== ""
    ? payload.result.stream_id
    : undefined;
};

const requestRelayStreamPull = async (
  transport: RelaySocketTransport,
  conversationId: string,
  requestId: string,
  streamId: string,
  timeoutMs: number,
  signing?: PayloadFrameSigningOptions,
  windowSize = DEFAULT_RELAY_PULL_WINDOW,
): Promise<number> => {
  const normalizedWindowSize = normalizeStreamPullWindowSize(
    windowSize,
    DEFAULT_RELAY_PULL_WINDOW,
  );
  const frame = await encodePayloadFrameAsync(
    {
      stream_id: streamId,
      request_id: requestId,
      window_size: normalizedWindowSize,
    },
    {
      requestId,
      omitTraceId: true,
      compression: "default",
      signing,
    },
  );

  const response = await new Promise<RelayStreamPullResponsePayload>(
    (resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        transport.off(rpcStreamPullResponseEvent, handlePullResponse);
        transport.off(appErrorEvent, handleAppError);
        transport.off(connectErrorEvent, handleConnectError);
        transport.off(disconnectEvent, handleDisconnect);
      };

      const handlePullResponse = (payload: unknown): void => {
        try {
          const response = normalizeStreamPullResponse(payload);
          if (
            response.success &&
            (response.conversationId !== conversationId ||
              response.requestId !== requestId ||
              response.streamId !== streamId)
          ) {
            return;
          }

          cleanup();
          resolve(response);
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
          new PlugTimeoutError(
            "Timed out while waiting for relay:rpc.stream.pull_response",
            {
              timeoutMs,
              eventName: rpcStreamPullResponseEvent,
              conversationId,
              requestId,
              streamId,
            },
          ),
        );
      }, timeoutMs);

      transport.on(rpcStreamPullResponseEvent, handlePullResponse);
      transport.on(appErrorEvent, handleAppError);
      transport.on(connectErrorEvent, handleConnectError);
      transport.on(disconnectEvent, handleDisconnect);
      transport.emit(rpcStreamPullEvent, {
        conversationId,
        frame,
      });
    },
  );

  if (!response.success) {
    throw createRelayControlError({
      code: response.error?.code ?? "RELAY_STREAM_PULL_FAILED",
      message: response.error?.message ?? "relay:rpc.stream.pull failed",
      statusCode: response.error?.statusCode,
      retryAfterMs: response.error?.retryAfterMs,
      details: response.rateLimit ? { rateLimit: response.rateLimit } : undefined,
    });
  }

  return typeof response.windowSize === "number" && response.windowSize > 0
    ? normalizeStreamPullWindowSize(response.windowSize, normalizedWindowSize)
    : normalizedWindowSize;
};

export const executeRelayCommand = async (
  input: ExecuteRelayCommandInput,
): Promise<PlugCommandTransportResult> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const limits = {
    maxBufferedChunkItems:
      input.bufferLimits?.maxBufferedChunkItems ?? defaultMaxBufferedChunkItems,
    maxBufferedRows: input.bufferLimits?.maxBufferedRows ?? defaultMaxBufferedRows,
    maxBufferedBytes: input.bufferLimits?.maxBufferedBytes ?? defaultMaxBufferedBytes,
  };
  const command = ensureRelayCompatibleCommand(input.command);
  const clientRequestId = String(command.id);
  let activeRequestId = clientRequestId;
  let conversationId: string | undefined;

  input.transport.connect();

  try {
    const connectionReady = await waitForSingleEvent(
      input.transport,
      connectionReadyEvent,
      timeoutMs,
      (payload) => normalizeConnectionReady(payload, input.payloadFrameSigning),
    );
    plugLogger.debug("transport.socket.connected", {
      agentId: input.agentId,
      socketId: connectionReady.id,
    });

    const conversationPromise = waitForSingleEvent(
      input.transport,
      conversationStartedEvent,
      timeoutMs,
      normalizeConversationStarted,
    );
    input.transport.emit(conversationStartEvent, {
      agentId: input.agentId,
    });
    const conversation = await conversationPromise;
    if (!conversation.success || !conversation.conversationId) {
      throw createRelayControlError({
        code: conversation.error?.code ?? "RELAY_CONVERSATION_START_FAILED",
        message: conversation.error?.message ?? "Failed to start relay conversation",
        statusCode: conversation.error?.statusCode,
        retryAfterMs: conversation.error?.retryAfterMs,
      });
    }

    conversationId = conversation.conversationId;
    plugLogger.debug("transport.socket.conversation_started", {
      agentId: input.agentId,
      conversationId,
    });
    const outboundFrame = await encodePayloadFrameAsync(command, {
      requestId: clientRequestId,
      compression: input.payloadFrameCompression ?? "default",
      signing: input.payloadFrameSigning,
    });

    const acceptedPromise = waitForSingleEvent(
      input.transport,
      rpcAcceptedEvent,
      timeoutMs,
      normalizeAcceptedPayload,
    );
    const acceptedStatePromise = acceptedPromise.then((payload) => {
      const accepted = assertAcceptedPayload(payload);
      activeRequestId = accepted.requestId;
      return accepted;
    });

    const chunkPayloads: JsonObject[] = [];
    const rawChunkFrames: PayloadFrameEnvelope[] = [];
    let rawResponseFrame: PayloadFrameEnvelope | undefined;
    let rawCompleteFrame: PayloadFrameEnvelope | undefined;
    let rawResponsePayload: unknown;
    let completePayload: JsonObject | undefined;
    let bufferedBytes = 0;
    let bufferedRows = 0;
    let chunkCount = 0;
    const relayConversationId = conversationId;

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

    const finalResponsePromise = new Promise<{
      readonly responseFrame: PayloadFrameEnvelope;
      readonly completeFrame?: PayloadFrameEnvelope;
      readonly responsePayload: unknown;
      readonly completePayload?: JsonObject;
    }>((resolve, reject) => {
      let activeStreamId: string | undefined;
      let streamCreditsRemaining = 0;
      let streamPullInFlight = false;
      let pendingChunksDuringPull = 0;
      let streamCompleted = false;

      const cleanup = (): void => {
        clearTimeout(timer);
        input.transport.off(rpcResponseEvent, responseListener);
        input.transport.off(rpcChunkEvent, chunkListener);
        input.transport.off(rpcCompleteEvent, completeListener);
        input.transport.off(appErrorEvent, handleAppError);
        input.transport.off(connectErrorEvent, handleConnectError);
        input.transport.off(disconnectEvent, handleDisconnect);
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new PlugTimeoutError("Timed out while waiting for relay RPC completion", {
            timeoutMs,
            requestId: activeRequestId,
            conversationId: relayConversationId,
          }),
        );
      }, timeoutMs);

      const matchesRequestId = async (
        frameRequestId: string | null | undefined,
      ): Promise<boolean> => {
        if (!frameRequestId) {
          return true;
        }

        if (frameRequestId === clientRequestId || frameRequestId === activeRequestId) {
          return true;
        }

        try {
          const accepted = await acceptedStatePromise;
          activeRequestId = accepted.requestId;
          return (
            frameRequestId === clientRequestId || frameRequestId === accepted.requestId
          );
        } catch {
          return false;
        }
      };

      const requestNextStreamWindow = async (): Promise<void> => {
        if (!activeStreamId || streamPullInFlight || streamCompleted) {
          return;
        }

        streamPullInFlight = true;
        let shouldRequestAdditionalWindow = false;
        try {
          const accepted = await acceptedStatePromise;
          const nextWindowSize = await requestRelayStreamPull(
            input.transport,
            relayConversationId,
            accepted.requestId,
            activeStreamId,
            timeoutMs,
            input.payloadFrameSigning,
            input.streamPullWindowSize ?? DEFAULT_RELAY_PULL_WINDOW,
          );
          streamCreditsRemaining = Math.max(nextWindowSize - pendingChunksDuringPull, 0);
          pendingChunksDuringPull = 0;
          shouldRequestAdditionalWindow =
            activeStreamId !== undefined &&
            streamCreditsRemaining === 0 &&
            !streamCompleted;
        } finally {
          streamPullInFlight = false;
        }

        if (shouldRequestAdditionalWindow && !streamCompleted) {
          await requestNextStreamWindow();
        }
      };

      const handleResponse = async (payload: unknown): Promise<void> => {
        try {
          const decoded = await decodePayloadFrameAsync<unknown>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!(await matchesRequestId(decoded.frame.requestId))) {
            return;
          }

          rawResponseFrame = decoded.frame;
          rawResponsePayload = decoded.data;
          bufferedBytes += decoded.frame.originalSize;
          bufferedRows += countResultRows(decoded.data);
          assertBufferLimits();

          const streamId = getStreamIdFromNormalizedResponse(decoded.data);
          if (!streamId) {
            cleanup();
            resolve({
              responseFrame: decoded.frame,
              responsePayload: decoded.data,
            });
            return;
          }

          activeStreamId = streamId;
          await requestNextStreamWindow();
        } catch (error: unknown) {
          cleanup();
          reject(error);
        }
      };

      const handleChunk = async (payload: unknown): Promise<void> => {
        try {
          const decoded = await decodePayloadFrameAsync<JsonObject>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!(await matchesRequestId(decoded.frame.requestId))) {
            return;
          }

          chunkCount += 1;
          bufferedBytes += decoded.frame.originalSize;
          bufferedRows += countRows(decoded.data.rows);
          const mergedResponse =
            input.responseMode === "aggregatedJson"
              ? tryMergeChunkRowsIntoResponse(rawResponsePayload, decoded.data)
              : undefined;
          if (mergedResponse !== undefined) {
            rawResponsePayload = removeStreamMarkerFromResponse(mergedResponse);
          } else {
            rawChunkFrames.push(decoded.frame);
            chunkPayloads.push(decoded.data);
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
      };

      const handleComplete = (payload: unknown): void => {
        void (async () => {
          const decoded = await decodePayloadFrameAsync<JsonObject>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!(await matchesRequestId(decoded.frame.requestId))) {
            return;
          }

          streamCompleted = true;
          rawCompleteFrame = decoded.frame;
          completePayload = decoded.data;
          const responseFrame =
            rawResponseFrame ??
            (await encodePayloadFrameAsync(
              {
                jsonrpc: "2.0",
                id: activeRequestId,
                result: {},
              },
              {
                requestId: activeRequestId,
                compression: "none",
                signing: input.payloadFrameSigning,
              },
            ));
          cleanup();
          resolve({
            responseFrame,
            completeFrame: decoded.frame,
            responsePayload: rawResponsePayload,
            completePayload,
          });
        })().catch((error: unknown) => {
          cleanup();
          reject(error);
        });
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

      const responseListener = (payload: unknown): void => {
        void handleResponse(payload);
      };
      const chunkListener = (payload: unknown): void => {
        void handleChunk(payload);
      };
      const completeListener = (payload: unknown): void => {
        handleComplete(payload);
      };

      input.transport.on(rpcResponseEvent, responseListener);
      input.transport.on(rpcChunkEvent, chunkListener);
      input.transport.on(rpcCompleteEvent, completeListener);
      input.transport.on(appErrorEvent, handleAppError);
      input.transport.on(connectErrorEvent, handleConnectError);
      input.transport.on(disconnectEvent, handleDisconnect);
    });
    void finalResponsePromise.catch(() => undefined);

    input.transport.emit(rpcRequestEvent, {
      conversationId,
      frame: outboundFrame,
      ...(input.payloadFrameCompression !== undefined
        ? { payloadFrameCompression: input.payloadFrameCompression }
        : {}),
    });

    const accepted = await acceptedStatePromise;
    plugLogger.debug("transport.socket.request_accepted", {
      agentId: input.agentId,
      conversationId,
      requestId: accepted.requestId,
      clientRequestId: accepted.clientRequestId,
      deduplicated: accepted.deduplicated,
      replayed: accepted.replayed,
      inFlight: accepted.inFlight,
      chunkCount,
      bufferedBytes,
      bufferedRows,
    });
    const finalResponse = await finalResponsePromise;

    return {
      channel: "socket",
      socketMode: "relay",
      agentId: input.agentId,
      requestId: accepted.requestId,
      notification: false,
      conversationId,
      accepted,
      connectionReady,
      response: normalizeRpcPayload(finalResponse.responsePayload),
      rawResponsePayload: finalResponse.responsePayload,
      chunkPayloads,
      completePayload: finalResponse.completePayload,
      rawResponseFrame: finalResponse.responseFrame,
      rawChunkFrames,
      rawCompleteFrame,
    };
  } finally {
    if (conversationId) {
      input.transport.emit(conversationEndEvent, { conversationId });
    }
    input.transport.disconnect();
  }
};
