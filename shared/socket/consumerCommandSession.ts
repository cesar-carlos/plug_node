import {
  DEFAULT_API_VERSION,
  DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  SOCKET_PROTOCOL_VERSION,
  type ConsumerCommandNotificationResponse,
  type JsonObject,
  type NormalizedAgentRpcResponse,
  type PlugCommandTransportResult,
  type RpcSingleCommand,
  type SocketCommandRuntimeMetrics,
} from "../contracts/api";
import { PlugTimeoutError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { estimateConsumerWireBytes } from "./consumerCommandWireBytes";
import {
  attachIdleCommandTimer,
  buildSocketCommandTimeoutError,
  createSettleOnce,
  resolveSocketCommandTimeouts,
} from "./socketSessionLifecycle";
import {
  createConsumerConnectError,
  createConsumerControlError,
  createConsumerDisconnectError,
  createConsumerSocketAppError,
} from "./consumerCommandSessionErrors";
import {
  consumerSocketAppErrorEvent,
  consumerSocketCommandEvent,
  consumerSocketCommandResponseEvent,
  consumerSocketCommandStreamChunkEvent,
  consumerSocketCommandStreamCompleteEvent,
  consumerSocketConnectErrorEvent,
  consumerSocketConnectionReadyEvent,
  consumerSocketDisconnectEvent,
} from "./consumerCommandSessionConstants";
import type {
  ConsumerSocketTransport,
  ExecuteConsumerCommandInput,
} from "./consumerCommandSessionTypes";
import {
  attachRetryAfterToConsumerResponse,
  isConsumerSingleSuccessWithRows,
  removeStreamMarkerFromConsumerResponse,
  tryMergeChunkRowsIntoConsumerResponse,
} from "./consumerCommandResponseMerge";
import {
  matchesConsumerCommandRequest,
  matchesConsumerStreamPayload,
  requestConsumerStreamPull,
} from "./consumerCommandStreamPull";
import {
  decodeConsumerCommandWirePayload,
  isConsumerNotificationResponse,
  normalizeConsumerCommandResponse,
  normalizeConsumerConnectionReady,
  normalizeConsumerStreamChunkPayload,
  normalizeConsumerStreamCompletePayload,
  resolveConsumerCommandRequestId,
  toConsumerCommandRequestId,
  withConsumerCommandRequestId,
} from "./consumerCommandWire";
import {
  assertSocketBufferWithinLimits,
  countRows,
  resolveSocketBufferLimits,
} from "./streamCommandSessionCommon";

export type {
  ConsumerSocketTransport,
  ExecuteConsumerCommandInput,
} from "./consumerCommandSessionTypes";

const buildCapabilityProbeCommand = (): RpcSingleCommand => ({
  jsonrpc: "2.0",
  method: "rpc.discover",
  id: null,
  api_version: DEFAULT_API_VERSION,
});

const waitForConsumerConnectionReady = async (
  transport: ConsumerSocketTransport,
  timeoutMs: number,
  signing?: ExecuteConsumerCommandInput["payloadFrameSigning"],
): Promise<import("../contracts/api").RelayConnectionReadyPayload | undefined> => {
  if (transport.connected) {
    return undefined;
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(consumerSocketConnectionReadyEvent, handleReady);
      transport.off(consumerSocketAppErrorEvent, handleAppError);
      transport.off(consumerSocketConnectErrorEvent, handleConnectError);
      transport.off(consumerSocketDisconnectEvent, handleDisconnect);
    };

    const handleReady = (payload: unknown): void => {
      cleanup();
      void normalizeConsumerConnectionReady(payload, signing).then(resolve, reject);
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createConsumerSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createConsumerConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createConsumerDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError("Timed out while waiting for socket connection:ready", {
          timeoutMs,
          eventName: consumerSocketConnectionReadyEvent,
        }),
      );
    }, timeoutMs);

    transport.on(consumerSocketConnectionReadyEvent, handleReady);
    transport.on(consumerSocketAppErrorEvent, handleAppError);
    transport.on(consumerSocketConnectErrorEvent, handleConnectError);
    transport.on(consumerSocketDisconnectEvent, handleDisconnect);
    transport.connect();
  });
};

export const executeConsumerCommand = async (
  input: ExecuteConsumerCommandInput,
): Promise<PlugCommandTransportResult> => {
  const timeouts = resolveSocketCommandTimeouts({ timeoutMs: input.timeoutMs });
  const limits = resolveSocketBufferLimits(input.bufferLimits);
  const commandStartMs = Date.now();
  const commandRequestId = resolveConsumerCommandRequestId(input.command);
  const command = withConsumerCommandRequestId(input.command, commandRequestId);
  const connectionReady = await waitForConsumerConnectionReady(
    input.transport,
    timeouts.connectTimeoutMs,
    input.payloadFrameSigning,
  );
  const connectedAfterMs = Date.now() - commandStartMs;

  plugLogger.debug("transport.socket.command.request", {
    agentId: input.agentId,
    method: Array.isArray(input.command) ? "batch" : input.command.method,
    timeoutMs: timeouts.commandTimeoutMs,
    connectTimeoutMs: timeouts.connectTimeoutMs,
    responseMode: input.responseMode,
    connectedAfterMs,
  });

  return new Promise<PlugCommandTransportResult>((resolve, reject) => {
    const settle = createSettleOnce();
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
      assertSocketBufferWithinLimits(limits, {
        bufferedBytes,
        bufferedRows,
        chunkCount,
      });
    };

    let chunkHandlerChain = Promise.resolve();

    const enqueueChunkWork = (work: () => Promise<void>): void => {
      chunkHandlerChain = chunkHandlerChain.then(work).catch((error: unknown) => {
        cleanup();
        settle.settleOnce(reject, error);
      });
    };

    const cleanup = (): void => {
      idleTimer.dispose();
      input.transport.off(consumerSocketCommandResponseEvent, handleCommandResponse);
      input.transport.off(
        consumerSocketCommandStreamChunkEvent,
        handleCommandStreamChunk,
      );
      input.transport.off(
        consumerSocketCommandStreamCompleteEvent,
        handleCommandStreamComplete,
      );
      input.transport.off(consumerSocketAppErrorEvent, handleAppError);
      input.transport.off(consumerSocketConnectErrorEvent, handleConnectError);
      input.transport.off(consumerSocketDisconnectEvent, handleDisconnect);
    };

    const idleTimer = attachIdleCommandTimer(settle, timeouts, () => {
      cleanup();
      settle.settleOnce(
        reject,
        buildSocketCommandTimeoutError({
          message: "Timed out while waiting for agents:command completion",
          timeoutMs: timeouts.commandTimeoutMs,
          eventName: consumerSocketCommandResponseEvent,
          details: {
            requestId: activeRequestId,
            streamId: activeStreamId,
            socketMode: "agentsCommand",
          },
        }),
      );
    });

    const finishResolve = (result: PlugCommandTransportResult): void => {
      cleanup();
      settle.settleOnce(resolve, {
        ...result,
        executionMetrics: {
          connectedAfterMs,
          ...("executionMetrics" in result ? result.executionMetrics : {}),
        },
      });
    };

    const resolveNotification = (
      requestId: string,
      response: ConsumerCommandNotificationResponse,
    ): void => {
      plugLogger.info("transport.socket.command.notification", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId,
        durationMs: Date.now() - commandStartMs,
      });
      finishResolve({
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
        idleTimer.resetIdleTimer();
        const nextWindowSize = await requestConsumerStreamPull(
          input.transport,
          activeRequestId,
          activeStreamId,
          timeouts.commandTimeoutMs,
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
          input.payloadFrameSigning,
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

    const handleCommandResponse = (payload: unknown): void => {
      void (async () => {
        if (settle.isSettled()) {
          return;
        }

        try {
          idleTimer.resetIdleTimer();
          const decodedPayload = await decodeConsumerCommandWirePayload(
            payload,
            input.payloadFrameSigning,
          );
          const response = normalizeConsumerCommandResponse(decodedPayload);
          if (!matchesConsumerCommandRequest(response, commandRequestId)) {
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
            settle.settleOnce(
              reject,
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
            !isConsumerNotificationResponse(response.response) &&
            isRecord(response.response) &&
            typeof response.response.type === "string"
              ? (response.response as NormalizedAgentRpcResponse)
              : undefined;
          normalizedResponse = attachRetryAfterToConsumerResponse(
            normalizedResponse,
            response.retryAfterSeconds,
          );
          bufferedBytes += estimateConsumerWireBytes(payload, response.response);

          if (isConsumerSingleSuccessWithRows(response.response)) {
            bufferedRows += countRows(response.response.item.result.rows);
          }
          assertBufferLimits();

          if (isConsumerNotificationResponse(response.response)) {
            resolveNotification(response.requestId, response.response);
            return;
          }

          activeStreamId =
            typeof response.streamId === "string" && response.streamId.trim() !== ""
              ? response.streamId
              : undefined;

          if (!activeStreamId) {
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
            finishResolve({
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
          settle.settleOnce(reject, error);
        }
      })();
    };

    const handleCommandStreamChunk = (payload: unknown): void => {
      enqueueChunkWork(async () => {
        if (settle.isSettled()) {
          return;
        }

        idleTimer.resetIdleTimer();
        const decodedPayload = await decodeConsumerCommandWirePayload(
          payload,
          input.payloadFrameSigning,
        );
        const chunk = normalizeConsumerStreamChunkPayload(decodedPayload);
        if (
          !matchesConsumerStreamPayload(
            chunk,
            activeRequestId,
            commandRequestId,
            activeStreamId,
            toConsumerCommandRequestId,
          )
        ) {
          ignoredStreamChunks += 1;
          plugLogger.debug("transport.socket.command.stream_chunk_ignored", {
            socketMode: "agentsCommand",
            agentId: input.agentId,
            expectedRequestId: activeRequestId,
            commandRequestId,
            expectedStreamId: activeStreamId,
            requestId: toConsumerCommandRequestId(chunk.request_id),
            streamId: typeof chunk.stream_id === "string" ? chunk.stream_id : undefined,
          });
          return;
        }

        chunkPayloads.push(chunk);
        chunkCount += 1;
        bufferedBytes += estimateConsumerWireBytes(payload, chunk);
        bufferedRows += countRows(chunk.rows);

        if (input.responseMode === "aggregatedJson") {
          const mergedResponse = tryMergeChunkRowsIntoConsumerResponse(
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
          enqueueChunkWork(async () => {
            if (!streamCompleted) {
              await requestNextStreamWindow();
            }
          });
        }
      });
    };

    const handleCommandStreamComplete = (payload: unknown): void => {
      enqueueChunkWork(async () => {
        if (settle.isSettled()) {
          return;
        }

        idleTimer.resetIdleTimer();
        const decodedPayload = await decodeConsumerCommandWirePayload(
          payload,
          input.payloadFrameSigning,
        );
        const complete = normalizeConsumerStreamCompletePayload(decodedPayload);
        if (
          !matchesConsumerStreamPayload(
            complete,
            activeRequestId,
            commandRequestId,
            activeStreamId,
            toConsumerCommandRequestId,
          )
        ) {
          ignoredStreamCompletes += 1;
          plugLogger.debug("transport.socket.command.stream_complete_ignored", {
            socketMode: "agentsCommand",
            agentId: input.agentId,
            expectedRequestId: activeRequestId,
            commandRequestId,
            expectedStreamId: activeStreamId,
            requestId: toConsumerCommandRequestId(complete.request_id),
            streamId:
              typeof complete.stream_id === "string" ? complete.stream_id : undefined,
          });
          return;
        }

        streamCompleted = true;
        completePayload = complete;
        if (input.responseMode === "aggregatedJson") {
          normalizedResponse = removeStreamMarkerFromConsumerResponse(normalizedResponse);
        }
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
        finishResolve({
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
      });
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      plugLogger.warn("transport.socket.command.app_error", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: activeRequestId,
        durationMs: Date.now() - commandStartMs,
      });
      settle.settleOnce(reject, createConsumerSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      plugLogger.warn("transport.socket.command.connect_error", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: activeRequestId,
        durationMs: Date.now() - commandStartMs,
      });
      settle.settleOnce(reject, createConsumerConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      plugLogger.warn("transport.socket.command.disconnected", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: activeRequestId,
        durationMs: Date.now() - commandStartMs,
      });
      settle.settleOnce(reject, createConsumerDisconnectError(payload));
    };

    input.transport.on(consumerSocketCommandResponseEvent, handleCommandResponse);
    input.transport.on(consumerSocketCommandStreamChunkEvent, handleCommandStreamChunk);
    input.transport.on(
      consumerSocketCommandStreamCompleteEvent,
      handleCommandStreamComplete,
    );
    input.transport.on(consumerSocketAppErrorEvent, handleAppError);
    input.transport.on(consumerSocketConnectErrorEvent, handleConnectError);
    input.transport.on(consumerSocketDisconnectEvent, handleDisconnect);
    input.transport.emit(consumerSocketCommandEvent, {
      protocolVersion: SOCKET_PROTOCOL_VERSION,
      requestId: commandRequestId,
      clientRequestId: commandRequestId,
      agentId: input.agentId,
      command,
      timeoutMs: timeouts.commandTimeoutMs,
      payloadFrameCompression: input.payloadFrameCompression ?? "default",
    });
  });
};

export const buildConsumerSocketCapabilityProbeCommand = buildCapabilityProbeCommand;
