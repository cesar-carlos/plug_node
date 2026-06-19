import {
  DEFAULT_RELAY_PULL_WINDOW,
  type JsonObject,
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
  getStreamIdFromNormalizedResponse,
  extractRpcBodyId,
} from "./relaySessionNormalization";
import { requestRelayStreamPull } from "./relayStreamPull";
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
  beginStreamPull,
  createStreamAggregationController,
  finishStreamPull,
  shouldSkipStreamPull,
} from "./streamAggregationState";

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
  let bufferedBytes = 0;
  let bufferedRows = 0;
  let chunkCount = 0;
  let ignoredResponses = 0;
  let ignoredChunks = 0;
  let ignoredCompletes = 0;
  let activeRequestId = input.clientRequestId;
  const streamAggregation = createStreamAggregationController();

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

      const enqueueChunkWork = (work: () => Promise<void>): void => {
        chunkHandlerChain = chunkHandlerChain.then(work).catch((error: unknown) => {
          cleanup();
          settle.settleOnce(reject, error);
        });
      };

      const cleanup = (): void => {
        idleTimer.dispose();
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

      const matchesRequestId = async (
        frameRequestId: string | null | undefined,
        decodedData?: unknown,
      ): Promise<boolean> => {
        if (input.fastPath === true) {
          const bodyId = extractRpcBodyId(decodedData);
          if (bodyId !== undefined && bodyId === input.clientRequestId) {
            return true;
          }
        }

        if (!frameRequestId || frameRequestId.trim() === "") {
          return false;
        }

        if (
          frameRequestId === input.clientRequestId ||
          frameRequestId === activeRequestId
        ) {
          return true;
        }

        try {
          const accepted = await input.acceptedStatePromise;
          activeRequestId = accepted.requestId;
          return (
            frameRequestId === input.clientRequestId ||
            frameRequestId === accepted.requestId
          );
        } catch {
          return input.fastPath === true && frameRequestId === input.clientRequestId;
        }
      };

      const requestNextStreamWindow = async (): Promise<void> => {
        if (shouldSkipStreamPull(streamAggregation.state)) {
          return;
        }

        beginStreamPull(streamAggregation.state);
        let shouldRequestAdditionalWindow = false;
        try {
          idleTimer.resetIdleTimer();
          const accepted = await input.acceptedStatePromise;
          const nextWindowSize = await requestRelayStreamPull(
            input.transport,
            input.conversationId,
            accepted.requestId,
            streamAggregation.state.activeStreamId as string,
            input.timeouts.commandTimeoutMs,
            input.payloadFrameSigning,
            input.streamPullWindowSize ?? DEFAULT_RELAY_PULL_WINDOW,
          );
          shouldRequestAdditionalWindow = finishStreamPull(
            streamAggregation.state,
            nextWindowSize,
          );
        } finally {
          streamAggregation.state.streamPullInFlight = false;
        }

        if (shouldRequestAdditionalWindow && !streamAggregation.state.streamCompleted) {
          await requestNextStreamWindow();
        }
      };

      const handleResponse = async (payload: unknown): Promise<void> => {
        if (settle.isSettled()) {
          return;
        }

        try {
          idleTimer.resetIdleTimer();
          const decoded = await decodePayloadFrameAsync<unknown>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!(await matchesRequestId(decoded.frame.requestId, decoded.data))) {
            ignoredResponses += 1;
            return;
          }

          if (input.fastPath === true) {
            activeRequestId = decoded.frame.requestId ?? input.clientRequestId;
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
        const decoded = await decodePayloadFrameAsync<JsonObject>(payload, {
          signing: input.payloadFrameSigning,
        });
        if (!(await matchesRequestId(decoded.frame.requestId, decoded.data))) {
          ignoredChunks += 1;
          return;
        }

        chunkCount += 1;
        bufferedBytes += decoded.frame.originalSize;
        bufferedRows += countRows(decoded.data.rows);
        const mergedResponse =
          input.responseMode === "aggregatedJson"
            ? tryMergeChunkRowsIntoRawRpcResponse(rawResponsePayload, decoded.data)
            : undefined;
        if (mergedResponse !== undefined) {
          rawResponsePayload = removeStreamMarkerFromRawRpcResponse(mergedResponse);
        } else {
          rawChunkFrames.push(decoded.frame);
          chunkPayloads.push(decoded.data);
        }
        assertBufferLimits();

        streamAggregation.recordChunkReceived();
        streamAggregation.schedulePullIfCreditsExhausted(
          enqueueChunkWork,
          requestNextStreamWindow,
        );
      };

      const handleComplete = (payload: unknown): void => {
        enqueueChunkWork(async () => {
          if (settle.isSettled()) {
            return;
          }

          idleTimer.resetIdleTimer();
          const decoded = await decodePayloadFrameAsync<JsonObject>(payload, {
            signing: input.payloadFrameSigning,
          });
          if (!(await matchesRequestId(decoded.frame.requestId, decoded.data))) {
            ignoredCompletes += 1;
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
        enqueueChunkWork(() => handleChunk(payload));
      };
      const completeListener = (payload: unknown): void => {
        handleComplete(payload);
      };

      input.transport.on(relayRpcResponseEvent, responseListener);
      input.transport.on(relayRpcChunkEvent, chunkListener);
      input.transport.on(relayRpcCompleteEvent, completeListener);
      input.transport.on(relayAppErrorEvent, handleAppError);
      input.transport.on(relayConnectErrorEvent, handleConnectError);
      input.transport.on(relayDisconnectEvent, handleDisconnect);
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
