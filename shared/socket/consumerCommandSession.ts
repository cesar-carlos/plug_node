import { registerSocketCommand, applySocketDecodeInOrder } from "./socketEventDispatcher";
import { resolveCommandTimeoutPolicy } from "./commandTimeoutPolicy";
import {
  DEFAULT_API_VERSION,
  DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  SOCKET_PROTOCOL_VERSION,
  type ConsumerCommandNotificationResponse,
  isSocketAggregatedResponseMode,
  type JsonObject,
  type NormalizedAgentRpcResponse,
  type PlugCommandTransportResult,
  type RpcSingleCommand,
  type SocketCommandRuntimeMetrics,
  type SocketTransportNotificationResult,
  type SocketTransportResult,
} from "../contracts/api";
import { PlugTimeoutError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { estimateConsumerWireBytes } from "./consumerCommandWireBytes";
import {
  attachIdleCommandTimer,
  buildSocketCommandTimeoutError,
  createSettleOnce,
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
import { createLazyParallelChunkDecodeQueue } from "./parallelChunkDecode";
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
import { resolveAdaptiveStreamPullWindowSize } from "./streamPullWindowPolicy";
import {
  beginStreamPull,
  createStreamAggregationController,
  finishStreamPull,
  abortStreamPull,
  shouldSkipStreamPull,
} from "./streamAggregationState";
import { extractServerTimings } from "./relaySessionNormalization";

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
  signal?: AbortSignal,
): Promise<import("../contracts/api").RelayConnectionReadyPayload | undefined> => {
  if (transport.connected) {
    return undefined;
  }

  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      signal?.removeEventListener("abort", handleAbort);
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
    const handleAbort = (): void => {
      cleanup();
      reject(new PlugTimeoutError("Socket connection wait cancelled", { timeoutMs }));
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

    if (signal?.aborted) {
      handleAbort();
      return;
    }
    signal?.addEventListener("abort", handleAbort, { once: true });

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
  const timeouts = resolveCommandTimeoutPolicy({
    timeoutMs: input.timeoutMs,
    command: input.command,
  });
  const limits = resolveSocketBufferLimits(input.bufferLimits);
  const commandStartMs = Date.now();
  const commandRequestId = resolveConsumerCommandRequestId(input.command);
  const command = withConsumerCommandRequestId(input.command, commandRequestId);
  const wireSession = registerSocketCommand({
    transport: input.transport,
    ids: [commandRequestId],
    agentId: input.agentId,
    signing: input.payloadFrameSigning,
    bufferLimits: input.bufferLimits,
  });
  input = {
    ...input,
    transport: wireSession.transport,
    payloadFrameSigning: wireSession.signing,
  };
  try {
    const connectionReady = await waitForConsumerConnectionReady(
      input.transport,
      timeouts.connectTimeoutMs,
      input.payloadFrameSigning,
      input.signal,
    );
    const effectiveStreamPullWindowSize = resolveAdaptiveStreamPullWindowSize({
      configured: input.streamPullWindowSize,
      agentRecommended: input.agentRecommendedStreamPullWindowSize,
      agentMax: input.agentMaxStreamPullWindowSize,
      fallback: DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
    });
    const connectedAfterMs = Date.now() - commandStartMs;

    plugLogger.debug("transport.socket.command.request", {
      agentId: input.agentId,
      method: Array.isArray(input.command) ? "batch" : input.command.method,
      timeoutMs: timeouts.commandTimeoutMs,
      connectTimeoutMs: timeouts.connectTimeoutMs,
      responseMode: input.responseMode,
      connectedAfterMs,
    });

    return await new Promise<PlugCommandTransportResult>((resolve, reject) => {
      const settle = createSettleOnce();
      const pullAbort = new AbortController();
      const chunkPayloads: JsonObject[] = [];
      let activeRequestId = commandRequestId;
      const streamAggregation = createStreamAggregationController();
      let rawResponsePayload: unknown;
      let normalizedResponse: NormalizedAgentRpcResponse | undefined;
      let completePayload: JsonObject | undefined;
      let chunkCount = 0;
      let bufferedBytes = 0;
      let bufferedRows = 0;
      let ignoredCommandResponses = 0;
      let ignoredStreamChunks = 0;
      let ignoredStreamCompletes = 0;
      let ignoredStreamPullResponses = 0;
      let capturedServerTimings: import("../contracts/api").PlugServerTimings | undefined;

      const buildMetrics = (): SocketCommandRuntimeMetrics => ({
        ...wireSession.metrics(),
        ignoredCommandResponses,
        ignoredStreamChunks,
        ignoredStreamCompletes,
        ignoredStreamPullResponses,
        streamPullRequests: streamAggregation.state.pullCount,
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

      const decodeQueue = createLazyParallelChunkDecodeQueue({
        signal: pullAbort.signal,
        maxPendingFrames: limits.maxBufferedChunkItems,
        maxPendingBytes: limits.maxBufferedBytes,
        accumulated: () => ({ bytes: bufferedBytes, frames: chunkCount }),
        onError: (error: unknown) => {
          cleanup();
          settle.settleOnce(reject, error);
        },
      });

      const enqueueChunkWork = (work: () => Promise<void>): void => {
        decodeQueue.enqueueOrderedWork(work);
      };

      const cleanup = (): void => {
        input.signal?.removeEventListener("abort", handleAbort);
        pullAbort.abort();
        wireSession.dispose();
        idleTimer.dispose();
        decodeQueue.clearPendingDecodes();
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
              streamId: streamAggregation.state.activeStreamId,
              socketMode: "agentsCommand",
            },
          }),
        );
      });
      const handleAbort = (): void => {
        cleanup();
        settle.settleOnce(
          reject,
          new PlugTimeoutError("Socket command wait cancelled", {
            timeoutMs: input.timeoutMs,
            commandDispatched: true,
          }),
        );
      };

      const finishResolve = (
        result: SocketTransportResult | SocketTransportNotificationResult,
      ): void => {
        cleanup();
        const serverTimings =
          capturedServerTimings ??
          ("rawResponsePayload" in result
            ? extractServerTimings(result.rawResponsePayload)
            : undefined);
        settle.settleOnce(resolve, {
          ...result,
          executionMetrics: {
            connectedAfterMs,
            ...(serverTimings ? { serverTimings } : {}),
            ...("executionMetrics" in result ? result.executionMetrics : {}),
          },
          ...(serverTimings && result.metrics
            ? {
                metrics: {
                  ...result.metrics,
                  serverTimings,
                  ...(input.requestServerTimings === true
                    ? { requestServerTimings: true }
                    : {}),
                },
              }
            : result.metrics
              ? {
                  metrics: {
                    ...result.metrics,
                    ...(input.requestServerTimings === true
                      ? { requestServerTimings: true }
                      : {}),
                  },
                }
              : {}),
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
        if (
          settle.isSettled() ||
          !wireSession.canReceive() ||
          shouldSkipStreamPull(streamAggregation.state)
        ) {
          return;
        }

        beginStreamPull(streamAggregation.state);
        let shouldRequestAdditionalWindow = false;
        try {
          const nextWindowSize = await requestConsumerStreamPull(
            input.transport,
            activeRequestId,
            streamAggregation.state.activeStreamId as string,
            timeouts.commandTimeoutMs,
            effectiveStreamPullWindowSize,
            (payload) => {
              ignoredStreamPullResponses += 1;
              plugLogger.debug("transport.socket.command.stream_pull_ignored", {
                socketMode: "agentsCommand",
                agentId: input.agentId,
                expectedRequestId: activeRequestId,
                expectedStreamId: streamAggregation.state.activeStreamId,
                requestId: payload.requestId,
                streamId: payload.streamId,
              });
            },
            input.payloadFrameSigning,
            { attachTerminalListeners: false, signal: pullAbort.signal },
          );
          await wireSession.drain();
          await decodeQueue.drainOrderedWork();
          if (settle.isSettled()) return;
          idleTimer.resetIdleTimer();
          shouldRequestAdditionalWindow = finishStreamPull(
            streamAggregation.state,
            nextWindowSize,
          );
        } catch (error: unknown) {
          abortStreamPull(streamAggregation.state);
          throw error;
        }

        if (shouldRequestAdditionalWindow && !streamAggregation.state.streamCompleted) {
          await requestNextStreamWindow();
        }
      };

      const handleCommandResponse = (payload: unknown): Promise<void> => {
        return (async () => {
          if (settle.isSettled()) {
            return;
          }

          try {
            const decodedPayload = await decodeConsumerCommandWirePayload(
              payload,
              input.payloadFrameSigning,
            );
            const response = normalizeConsumerCommandResponse(decodedPayload);
            if (settle.isSettled()) {
              return;
            }
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

            idleTimer.resetIdleTimer();
            capturedServerTimings =
              extractServerTimings(response) ??
              (response.success ? extractServerTimings(response.response) : undefined);

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

            const streamId =
              typeof response.streamId === "string" && response.streamId.trim() !== ""
                ? response.streamId
                : undefined;

            if (!streamId) {
              plugLogger.info("transport.socket.command.complete", {
                socketMode: "agentsCommand",
                agentId: input.agentId,
                requestId: response.requestId,
                durationMs: Date.now() - commandStartMs,
                chunkCount,
                pullCount: streamAggregation.state.pullCount,
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

            streamAggregation.setActiveStreamId(streamId);
            if (isSocketAggregatedResponseMode(input.responseMode)) {
              normalizedResponse =
                removeStreamMarkerFromConsumerResponse(normalizedResponse);
            }
            void streamAggregation
              .requestInitialWindow(requestNextStreamWindow)
              .catch((error: unknown) => {
                cleanup();
                settle.settleOnce(reject, error);
              });
          } catch (error: unknown) {
            cleanup();
            settle.settleOnce(reject, error);
          }
        })();
      };

      const handleCommandStreamChunk = (payload: unknown): Promise<void> | void => {
        if (settle.isSettled()) {
          return;
        }

        return applySocketDecodeInOrder(
          input.transport,
          decodeQueue,
          async () => {
            const decodedPayload = await decodeConsumerCommandWirePayload(
              payload,
              input.payloadFrameSigning,
            );
            const chunk = normalizeConsumerStreamChunkPayload(decodedPayload);
            return {
              chunk,
              wireBytes: estimateConsumerWireBytes(payload, chunk),
            };
          },
          ({ chunk, wireBytes }) => {
            if (settle.isSettled()) {
              return;
            }
            if (
              !matchesConsumerStreamPayload(
                chunk,
                activeRequestId,
                commandRequestId,
                streamAggregation.state.activeStreamId,
                toConsumerCommandRequestId,
              )
            ) {
              ignoredStreamChunks += 1;
              plugLogger.debug("transport.socket.command.stream_chunk_ignored", {
                socketMode: "agentsCommand",
                agentId: input.agentId,
                expectedRequestId: activeRequestId,
                commandRequestId,
                expectedStreamId: streamAggregation.state.activeStreamId,
                requestId: toConsumerCommandRequestId(chunk.request_id),
                streamId:
                  typeof chunk.stream_id === "string" ? chunk.stream_id : undefined,
              });
              return;
            }

            idleTimer.resetIdleTimer();

            chunkPayloads.push(chunk);
            chunkCount += 1;
            bufferedBytes += wireBytes;
            bufferedRows += countRows(chunk.rows);

            if (isSocketAggregatedResponseMode(input.responseMode)) {
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

            streamAggregation.recordChunkReceived();
            streamAggregation.schedulePullIfCreditsExhausted(
              enqueueChunkWork,
              async () => {
                void requestNextStreamWindow().catch((error: unknown) => {
                  cleanup();
                  settle.settleOnce(reject, error);
                });
              },
            );
          },
        );
      };

      const handleCommandStreamComplete = (payload: unknown): Promise<void> => {
        return decodeQueue.enqueueOrderedWork(async () => {
          if (settle.isSettled()) {
            return;
          }

          const decodedPayload = await decodeConsumerCommandWirePayload(
            payload,
            input.payloadFrameSigning,
          );
          if (settle.isSettled()) {
            return;
          }
          const complete = normalizeConsumerStreamCompletePayload(decodedPayload);
          if (
            !matchesConsumerStreamPayload(
              complete,
              activeRequestId,
              commandRequestId,
              streamAggregation.state.activeStreamId,
              toConsumerCommandRequestId,
            )
          ) {
            ignoredStreamCompletes += 1;
            plugLogger.debug("transport.socket.command.stream_complete_ignored", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              expectedRequestId: activeRequestId,
              commandRequestId,
              expectedStreamId: streamAggregation.state.activeStreamId,
              requestId: toConsumerCommandRequestId(complete.request_id),
              streamId:
                typeof complete.stream_id === "string" ? complete.stream_id : undefined,
            });
            return;
          }

          idleTimer.resetIdleTimer();

          streamAggregation.state.streamCompleted = true;
          completePayload = complete;
          plugLogger.info("transport.socket.command.complete", {
            socketMode: "agentsCommand",
            agentId: input.agentId,
            requestId: activeRequestId,
            durationMs: Date.now() - commandStartMs,
            chunkCount,
            pullCount: streamAggregation.state.pullCount,
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
              isSocketAggregatedResponseMode(input.responseMode) && normalizedResponse
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

      if (input.signal?.aborted) {
        handleAbort();
        return;
      }
      input.signal?.addEventListener("abort", handleAbort, { once: true });
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
        timeoutMs: timeouts.hubWaitTimeoutMs,
        payloadFrameCompression: input.payloadFrameCompression ?? "default",
        ...(input.requestServerTimings === true ? { requestServerTimings: true } : {}),
      });
    });
  } finally {
    wireSession.dispose();
  }
};

export const buildConsumerSocketCapabilityProbeCommand = buildCapabilityProbeCommand;
