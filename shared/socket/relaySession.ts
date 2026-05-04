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
  type SocketAppErrorPayload,
} from "../contracts/api";
import type { PayloadFrameEnvelope } from "../contracts/payload-frame";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { normalizeRpcPayload } from "../output/rpcNormalization";
import { decodePayloadFrame, encodePayloadFrame } from "./payloadFrameCodec";
import { isRecord } from "../utils/json";

const appErrorEvent = "app:error";
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

const createSocketAppError = (payload: unknown): PlugError => {
  const appError = isRecord(payload) ? (payload as SocketAppErrorPayload) : {};
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

const createRelayControlError = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
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

  if (code === "RATE_LIMITED" || input.statusCode === 429) {
    return new PlugError("Plug rate limited the socket request.", {
      code,
      statusCode: input.statusCode,
      description: "Wait a moment before trying this socket operation again.",
      details: input.details,
      technicalMessage: input.message,
    });
  }

  if (input.statusCode === 503) {
    return new PlugError("Plug socket transport is temporarily unavailable.", {
      code,
      statusCode: input.statusCode,
      description: "The hub or agent may be overloaded. Try again shortly.",
      details: input.details,
      technicalMessage: input.message,
    });
  }

  return new PlugError(input.message ?? "Socket relay request failed.", {
    code,
    statusCode: input.statusCode,
    details: input.details,
  });
};

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
  readonly responseMode: PlugResponseMode;
}

const waitForSingleEvent = <TPayload>(
  transport: RelaySocketTransport,
  eventName: string,
  timeoutMs: number,
  parser: (payload: unknown) => TPayload,
): Promise<TPayload> =>
  new Promise<TPayload>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(eventName, handlePayload);
      transport.off(appErrorEvent, handleAppError);
    };

    const handlePayload = (payload: unknown): void => {
      cleanup();
      try {
        resolve(parser(payload));
      } catch (error: unknown) {
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
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
  });

const normalizeConnectionReady = (payload: unknown): RelayConnectionReadyPayload =>
  decodePayloadFrame<RelayConnectionReadyPayload>(payload).data;

const normalizeConversationStarted = (
  payload: unknown,
): RelayConversationStartedPayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("relay:conversation.started must be an object");
  }

  return payload as unknown as RelayConversationStartedPayload;
};

const normalizeAcceptedPayload = (payload: unknown): RelayRpcAcceptedPayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("relay:rpc.accepted must be an object");
  }

  return payload as unknown as RelayRpcAcceptedPayload;
};

const normalizeStreamPullResponse = (
  payload: unknown,
): RelayStreamPullResponsePayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("relay:rpc.stream.pull_response must be an object");
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
  });
};

const ensureRelayCompatibleCommand = (command: RpcSingleCommand): RpcSingleCommand => {
  if (command.method === "sql.executeBatch") {
    throw new PlugValidationError("Socket channel does not support Execute Batch in v1");
  }

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
  windowSize = DEFAULT_RELAY_PULL_WINDOW,
): Promise<number> => {
  const frame = encodePayloadFrame(
    {
      stream_id: streamId,
      request_id: requestId,
      window_size: windowSize,
    },
    {
      requestId,
      compression: "default",
    },
  );

  const responsePromise = waitForSingleEvent(
    transport,
    rpcStreamPullResponseEvent,
    timeoutMs,
    normalizeStreamPullResponse,
  );
  transport.emit(rpcStreamPullEvent, {
    conversationId,
    frame,
  });

  const response = await responsePromise;
  if (!response.success) {
    throw createRelayControlError({
      code: response.error?.code ?? "RELAY_STREAM_PULL_FAILED",
      message: response.error?.message ?? "relay:rpc.stream.pull failed",
      statusCode: response.error?.statusCode,
      details: response.rateLimit ? { rateLimit: response.rateLimit } : undefined,
    });
  }

  return typeof response.windowSize === "number" && response.windowSize > 0
    ? response.windowSize
    : windowSize;
};

export const executeRelayCommand = async (
  input: ExecuteRelayCommandInput,
): Promise<PlugCommandTransportResult> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
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
      normalizeConnectionReady,
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
      });
    }

    conversationId = conversation.conversationId;
    plugLogger.debug("transport.socket.conversation_started", {
      agentId: input.agentId,
      conversationId,
    });
    const outboundFrame = encodePayloadFrame(command, {
      requestId: clientRequestId,
      compression: input.payloadFrameCompression ?? "default",
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
    const relayConversationId = conversationId;

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
        frameRequestId: string | undefined,
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
          const decoded = decodePayloadFrame<unknown>(payload);
          if (!(await matchesRequestId(decoded.frame.requestId))) {
            return;
          }

          rawResponseFrame = decoded.frame;
          rawResponsePayload = decoded.data;

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
          const decoded = decodePayloadFrame<JsonObject>(payload);
          if (!(await matchesRequestId(decoded.frame.requestId))) {
            return;
          }

          rawChunkFrames.push(decoded.frame);
          chunkPayloads.push(decoded.data);

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
          const decoded = decodePayloadFrame<JsonObject>(payload);
          if (!(await matchesRequestId(decoded.frame.requestId))) {
            return;
          }

          streamCompleted = true;
          rawCompleteFrame = decoded.frame;
          completePayload = decoded.data;
          cleanup();
          resolve({
            responseFrame:
              rawResponseFrame ??
              encodePayloadFrame(
                {
                  jsonrpc: "2.0",
                  id: activeRequestId,
                  result: {},
                },
                { requestId: activeRequestId, compression: "none" },
              ),
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
