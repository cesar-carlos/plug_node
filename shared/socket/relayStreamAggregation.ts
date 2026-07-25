import {
  DEFAULT_RELAY_PULL_WINDOW,
  type JsonObject,
  isSocketAggregatedResponseMode,
  type PlugResponseMode,
  type RelayRpcAcceptedSuccessPayload,
} from "../contracts/api";
import type {
  PayloadFrameEnvelope,
  PayloadFrameSigningOptions,
} from "../contracts/payload-frame";
import { plugLogger } from "../logging/plugLogger";
import { decodePayloadFrameAsync, encodePayloadFrameAsync } from "./payloadFrameCodec";
import {
  relayAppErrorEvent,
  relayConnectErrorEvent,
  relayDisconnectEvent,
  relayRpcAcceptedEvent,
  relayRpcChunkEvent,
  relayRpcCompleteEvent,
  relayRpcResponseEvent,
} from "./relaySessionConstants";
import {
  createRelayConnectError,
  createRelayDisconnectError,
  createRelaySocketAppError,
} from "./relaySessionErrors";
import {
  assertRelayAcceptedPayload,
  getStreamIdFromNormalizedResponse,
  extractRpcBodyId,
  normalizeRelayAcceptedPayload,
} from "./relaySessionNormalization";
import type { RelaySocketTransport } from "./relaySessionTypes";
import {
  attachIdleCommandTimer,
  buildSocketCommandTimeoutError,
  createSettleOnce,
  type SocketCommandTimeouts,
} from "./socketSessionLifecycle";
import {
  assertSocketBufferWithinLimits,
  countResultRows,
  countRows,
  removeStreamMarkerFromRawRpcResponse,
  tryMergeChunkRowsIntoRawRpcResponse,
  type SocketBufferLimits,
} from "./streamCommandSessionCommon";
import {
  abortStreamPull,
  beginStreamPull,
  createStreamAggregationController,
  finishStreamPull,
  shouldSkipStreamPull,
} from "./streamAggregationState";
import { MAX_PARALLEL_CHUNK_DECODES } from "./streamPullPrefetch";
import { createRelayStreamPullSession } from "./streamPullSession";

export interface RelayStreamAggregationInput {
  readonly transport: RelaySocketTransport;
  readonly conversationId: string;
  readonly clientRequestId: string;
  readonly acceptedStatePromise: Promise<RelayRpcAcceptedSuccessPayload>;
  readonly responseMode: PlugResponseMode;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly streamPullWindowSize?: number;
  readonly fastPath?: boolean;
  readonly timeouts: SocketCommandTimeouts;
  readonly limits: SocketBufferLimits;
}

export interface RelayStreamAggregationResult {
  readonly responseFrame: PayloadFrameEnvelope;
  readonly completeFrame?: PayloadFrameEnvelope;
  readonly responsePayload: unknown;
  readonly completePayload?: JsonObject;
}

export interface RelayStreamAggregationMetrics {
  readonly ignoredResponses: number;
  readonly ignoredChunks: number;
  readonly ignoredCompletes: number;
  readonly pullCount: number;
  readonly chunkCount: number;
  readonly bufferedBytes: number;
  readonly bufferedRows: number;
}

type RelayStreamAggregationOutput = {
  readonly result: RelayStreamAggregationResult;
  readonly metrics: RelayStreamAggregationMetrics;
  readonly chunkPayloads: JsonObject[];
  readonly rawChunkFrames: PayloadFrameEnvelope[];
  readonly rawCompleteFrame?: PayloadFrameEnvelope;
};

export const waitForRelayStreamAggregation = (
  input: RelayStreamAggregationInput,
): Promise<RelayStreamAggregationOutput> => {
  const chunkPayloads: JsonObject[] = [];
  const rawChunkFrames: PayloadFrameEnvelope[] = [];
  let rawResponseFrame: PayloadFrameEnvelope | undefined;
  let rawCompleteFrame: PayloadFrameEnvelope | undefined;
  let rawResponsePayload: unknown;
  let completePayload: JsonObject | undefined;
  let pendingCompletePayload: unknown | undefined;
  let bufferedBytes = 0;
  let bufferedRows = 0;
  let chunkCount = 0;
  let ignoredResponses = 0;
  let ignoredChunks = 0;
  let ignoredCompletes = 0;
  let activeRequestId = input.clientRequestId;
  let hubRequestId = input.clientRequestId;
  const keepRawChunkFrames = !isSocketAggregatedResponseMode(input.responseMode);
  const streamAggregation = createStreamAggregationController();
  const pullSession = createRelayStreamPullSession(
    input.transport,
    input.payloadFrameSigning,
  );

  const assertBufferLimits = (): void => {
    assertSocketBufferWithinLimits(input.limits, {
      bufferedBytes,
      bufferedRows,
      chunkCount,
    });
  };

  const aggregationPromise = new Promise<RelayStreamAggregationOutput>(
    (resolve, reject) => {
      const settle = createSettleOnce();
      let chunkHandlerChain = Promise.resolve();
      let inflightDecodes = 0;
      const pendingDecodeQueue: Array<() => void> = [];

      const pumpDecodeQueue = (): void => {
        while (
          inflightDecodes < MAX_PARALLEL_CHUNK_DECODES &&
          pendingDecodeQueue.length > 0
        ) {
          const next = pendingDecodeQueue.shift();
          if (!next) {
            return;
          }
          next();
        }
      };

      const enqueueChunkWork = (work: () => Promise<void>): void => {
        chunkHandlerChain = chunkHandlerChain.then(work).catch((error: unknown) => {
          cleanup();
          settle.settleOnce(reject, error);
        });
      };

      const enqueueBoundedDecode = (work: () => Promise<void>): void => {
        const run = (): void => {
          inflightDecodes += 1;
          enqueueChunkWork(async () => {
            try {
              await work();
            } finally {
              inflightDecodes = Math.max(0, inflightDecodes - 1);
              pumpDecodeQueue();
            }
          });
        };

        if (inflightDecodes < MAX_PARALLEL_CHUNK_DECODES) {
          run();
          return;
        }

        pendingDecodeQueue.push(run);
      };

      const cleanup = (): void => {
        idleTimer.dispose();
        pullSession.dispose();
        pendingDecodeQueue.length = 0;
        input.transport.off(relayRpcAcceptedEvent, handleAccepted);
        input.transport.off(relayRpcResponseEvent, responseListener);
        input.transport.off(relayRpcChunkEvent, chunkListener);
        input.transport.off(relayRpcCompleteEvent, completeListener);
        input.transport.off(relayAppErrorEvent, handleAppError);
        input.transport.off(relayConnectErrorEvent, handleConnectError);
        input.transport.off(relayDisconnectEvent, handleDisconnect);
      };

      const idleTimer = attachIdleCommandTimer(settle, input.timeouts, () => {
        cleanup();
        settle.settleOnce(
          reject,
          buildSocketCommandTimeoutError({
            message: "Timed out while waiting for relay RPC completion",
            timeoutMs: input.timeouts.commandTimeoutMs,
            eventName: relayRpcResponseEvent,
            details: {
              requestId: activeRequestId,
              conversationId: input.conversationId,
            },
          }),
        );
      });

      const finishResolve = (value: RelayStreamAggregationResult): void => {
        cleanup();
        settle.settleOnce(resolve, {
          result: value,
          metrics: {
            ignoredResponses,
            ignoredChunks,
            ignoredCompletes,
            pullCount: streamAggregation.state.pullCount,
            chunkCount,
            bufferedBytes,
            bufferedRows,
          },
          chunkPayloads,
          rawChunkFrames,
          rawCompleteFrame,
        });
      };

      const matchesRequestId = (
        frameRequestId: string | null | undefined,
        decodedData?: unknown,
      ): boolean => {
        // Prefer JSON-RPC body id: under non-fastPath the hub frame requestId is a
        // UUID that may arrive before relay:rpc.accepted updates hubRequestId.
        const bodyId = extractRpcBodyId(decodedData);
        if (bodyId !== undefined && bodyId === input.clientRequestId) {
          return true;
        }

        if (!frameRequestId || frameRequestId.trim() === "") {
          return false;
        }

        return (
          frameRequestId === input.clientRequestId ||
          frameRequestId === activeRequestId ||
          frameRequestId === hubRequestId
        );
      };

      const adoptAcceptedRequestId = (acceptedRequestId: string): void => {
        // Stream pulls must use the hub UUID from the response PayloadFrame when
        // present. fastPath synthetic accepted uses clientRequestId and must not
        // overwrite that frame-bound hub id (inadvertent streams under fastPath).
        if (
          hubRequestId !== input.clientRequestId &&
          hubRequestId !== acceptedRequestId
        ) {
          return;
        }

        hubRequestId = acceptedRequestId;
        activeRequestId = acceptedRequestId;
      };

      const ensureAcceptedHubRequestId = async (): Promise<void> => {
        if (input.fastPath === true) {
          return;
        }

        const accepted = await input.acceptedStatePromise;
        adoptAcceptedRequestId(accepted.requestId);
      };

      const requestNextStreamWindow = async (options?: {
        readonly drainQueuedHandlers?: boolean;
      }): Promise<void> => {
        if (shouldSkipStreamPull(streamAggregation.state)) {
          return;
        }

        beginStreamPull(streamAggregation.state);
        let shouldRequestAdditionalWindow = false;
        try {
          await ensureAcceptedHubRequestId();
          if (input.fastPath === true) {
            const accepted = await input.acceptedStatePromise;
            adoptAcceptedRequestId(accepted.requestId);
          }

          idleTimer.resetIdleTimer();
          const nextWindowSize = await pullSession.requestPull({
            conversationId: input.conversationId,
            requestId: hubRequestId,
            streamId: streamAggregation.state.activeStreamId as string,
            timeoutMs: input.timeouts.commandTimeoutMs,
            windowSize: input.streamPullWindowSize ?? DEFAULT_RELAY_PULL_WINDOW,
          });
          shouldRequestAdditionalWindow = finishStreamPull(
            streamAggregation.state,
            nextWindowSize,
          );
        } catch (error: unknown) {
          abortStreamPull(streamAggregation.state);
          throw error;
        }

        // Drain handlers queued by this pull turn. Skip when already running on the
        // chunk chain (follow-up pulls) to avoid awaiting the current chain task.
        if (options?.drainQueuedHandlers !== false) {
          await chunkHandlerChain;
        }

        if (shouldRequestAdditionalWindow && !streamAggregation.state.streamCompleted) {
          await requestNextStreamWindow(options);
        }
      };

      const handleResponse = async (payload: unknown): Promise<void> => {
        if (settle.isSettled()) {
          return;
        }

        try {
          await ensureAcceptedHubRequestId();
          idleTimer.resetIdleTimer();
          const decoded = await decodePayloadFrameAsync<unknown>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!matchesRequestId(decoded.frame.requestId, decoded.data)) {
            ignoredResponses += 1;
            return;
          }

          if (typeof decoded.frame.requestId === "string" && decoded.frame.requestId) {
            activeRequestId = decoded.frame.requestId;
            hubRequestId = decoded.frame.requestId;
          }

          rawResponseFrame = decoded.frame;
          rawResponsePayload = decoded.data;
          bufferedBytes += decoded.frame.originalSize;
          bufferedRows += countResultRows(decoded.data);
          assertBufferLimits();

          const streamId = getStreamIdFromNormalizedResponse(decoded.data);
          if (!streamId) {
            finishResolve({
              responseFrame: decoded.frame,
              responsePayload: decoded.data,
            });
            return;
          }

          streamAggregation.setActiveStreamId(streamId);
          if (pendingCompletePayload !== undefined) {
            const pending = pendingCompletePayload;
            pendingCompletePayload = undefined;
            handleComplete(pending);
            return;
          }
          await streamAggregation.requestInitialWindow(requestNextStreamWindow);
        } catch (error: unknown) {
          cleanup();
          settle.settleOnce(reject, error);
        }
      };

      const handleChunk = async (payload: unknown): Promise<void> => {
        if (settle.isSettled()) {
          return;
        }

        idleTimer.resetIdleTimer();
        try {
          await ensureAcceptedHubRequestId();
        } catch (error: unknown) {
          cleanup();
          settle.settleOnce(reject, error);
          return;
        }
        const decoded = await decodePayloadFrameAsync<JsonObject>(payload, {
          signing: input.payloadFrameSigning,
        });
        if (!matchesRequestId(decoded.frame.requestId, decoded.data)) {
          ignoredChunks += 1;
          return;
        }

        if (!streamAggregation.state.activeStreamId) {
          ignoredChunks += 1;
          return;
        }

        chunkCount += 1;
        bufferedBytes += decoded.frame.originalSize;
        bufferedRows += countRows(decoded.data.rows);
        const mergedResponse = isSocketAggregatedResponseMode(input.responseMode)
          ? tryMergeChunkRowsIntoRawRpcResponse(rawResponsePayload, decoded.data)
          : undefined;
        if (mergedResponse !== undefined) {
          rawResponsePayload = removeStreamMarkerFromRawRpcResponse(mergedResponse);
        } else {
          if (keepRawChunkFrames) {
            rawChunkFrames.push(decoded.frame);
          }
          chunkPayloads.push(decoded.data);
        }
        assertBufferLimits();

        streamAggregation.recordChunkReceived();
        streamAggregation.schedulePullIfCreditsExhausted(
          enqueueChunkWork,
          () => requestNextStreamWindow({ drainQueuedHandlers: false }),
        );
      };

      const handleComplete = (payload: unknown): void => {
        enqueueChunkWork(async () => {
          if (settle.isSettled()) {
            return;
          }

          idleTimer.resetIdleTimer();
          try {
            await ensureAcceptedHubRequestId();
          } catch (error: unknown) {
            cleanup();
            settle.settleOnce(reject, error);
            return;
          }
          const decoded = await decodePayloadFrameAsync<JsonObject>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!matchesRequestId(decoded.frame.requestId, decoded.data)) {
            ignoredCompletes += 1;
            return;
          }

          if (rawResponsePayload === undefined) {
            // Response may still be awaiting accepted/decode; process after it lands.
            pendingCompletePayload = payload;
            return;
          }

          streamAggregation.state.streamCompleted = true;
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
          finishResolve({
            responseFrame,
            completeFrame: decoded.frame,
            responsePayload: rawResponsePayload,
            completePayload,
          });
        });
      };

      const handleAccepted = (payload: unknown): void => {
        try {
          const accepted = assertRelayAcceptedPayload(
            normalizeRelayAcceptedPayload(payload),
          );
          adoptAcceptedRequestId(accepted.requestId);
        } catch {
          // Leave rejection to acceptedStatePromise / outer race.
        }
      };

      const handleAppError = (payload: unknown): void => {
        cleanup();
        settle.settleOnce(reject, createRelaySocketAppError(payload));
      };

      const handleConnectError = (payload: unknown): void => {
        cleanup();
        settle.settleOnce(reject, createRelayConnectError(payload));
      };

      const handleDisconnect = (payload: unknown): void => {
        cleanup();
        settle.settleOnce(reject, createRelayDisconnectError(payload));
      };

      const responseListener = (payload: unknown): void => {
        void handleResponse(payload);
      };
      const chunkListener = (payload: unknown): void => {
        enqueueBoundedDecode(() => handleChunk(payload));
      };
      const completeListener = (payload: unknown): void => {
        handleComplete(payload);
      };

      // Apply hub requestId synchronously on accepted so the following
      // relay:rpc.response in the same turn can match immediately.
      input.transport.on(relayRpcAcceptedEvent, handleAccepted);
      input.transport.on(relayRpcResponseEvent, responseListener);
      input.transport.on(relayRpcChunkEvent, chunkListener);
      input.transport.on(relayRpcCompleteEvent, completeListener);
      input.transport.on(relayAppErrorEvent, handleAppError);
      input.transport.on(relayConnectErrorEvent, handleConnectError);
      input.transport.on(relayDisconnectEvent, handleDisconnect);

      void input.acceptedStatePromise.then(
        (accepted) => {
          adoptAcceptedRequestId(accepted.requestId);
        },
        () => undefined,
      );
    },
  );

  void aggregationPromise.catch((error: unknown) => {
    plugLogger.debug("transport.socket.relay_final_response_rejected", {
      conversationId: input.conversationId,
      message: error instanceof Error ? error.message : String(error),
    });
  });

  return aggregationPromise;
};
