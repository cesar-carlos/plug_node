import type {
  PlugCommandTransportResult,
  SocketCommandRuntimeMetrics,
} from "../contracts/api";
import { plugLogger } from "../logging/plugLogger";
import { normalizeRpcPayload } from "../output/rpcNormalization";
import { encodePayloadFrameAsync } from "./payloadFrameCodec";
import {
  relayConnectionReadyEvent,
  relayConversationEndEvent,
  relayConversationStartEvent,
  relayConversationStartedEvent,
  relayRpcAcceptedEvent,
  relayRpcRequestEvent,
} from "./relaySessionConstants";
import { createRelayControlError } from "./relaySessionErrors";
import {
  assertRelayAcceptedPayload,
  ensureRelayCompatibleCommand,
  extractServerTimings,
  normalizeRelayConnectionReady,
  normalizeRelayConversationStarted,
  normalizeRelayAcceptedPayload,
} from "./relaySessionNormalization";
import { waitForRelaySingleEvent } from "./relaySessionWait";
import { waitForRelayStreamAggregation } from "./relayStreamAggregation";
import type { ExecuteRelayCommandInput } from "./relaySessionTypes";
import {
  extractMaxStreamPullWindowSize,
  extractRecommendedStreamPullWindowSize,
  resolveAdaptiveStreamPullWindowSize,
} from "./streamPullWindowPolicy";
import { resolveSocketBufferLimits } from "./streamCommandSessionCommon";
import { resolveSocketCommandTimeouts } from "./socketSessionLifecycle";

export type { ExecuteRelayCommandInput, RelaySocketTransport } from "./relaySessionTypes";

const buildSyntheticAcceptedState = (
  conversationId: string,
  clientRequestId: string,
): import("../contracts/api").RelayRpcAcceptedSuccessPayload => ({
  success: true,
  conversationId,
  requestId: clientRequestId,
  clientRequestId,
});

const waitForRelayAcceptedFailure = (
  transport: ExecuteRelayCommandInput["transport"],
): Promise<never> =>
  new Promise<never>((_, reject) => {
    const handleAccepted = (payload: unknown): void => {
      transport.off(relayRpcAcceptedEvent, handleAccepted);
      try {
        assertRelayAcceptedPayload(normalizeRelayAcceptedPayload(payload));
      } catch (error: unknown) {
        reject(error);
      }
    };

    transport.on(relayRpcAcceptedEvent, handleAccepted);
  });

export const executeRelayCommand = async (
  input: ExecuteRelayCommandInput,
): Promise<PlugCommandTransportResult> => {
  const timeouts = resolveSocketCommandTimeouts({ timeoutMs: input.timeoutMs });
  const limits = resolveSocketBufferLimits(input.bufferLimits);
  const command = ensureRelayCompatibleCommand(input.command);
  const clientRequestId = String(command.id);
  let conversationId: string | undefined = input.reusedConversationId;
  const managedTransport = input.managedTransport === true;
  const fastPath = input.fastPath === true;
  const commandStartMs = Date.now();
  let connectionReady: import("../contracts/api").RelayConnectionReadyPayload | undefined;

  if (!managedTransport || !input.transport.connected) {
    input.transport.connect();
  }

  try {
    connectionReady = input.transport.connected
      ? undefined
      : await waitForRelaySingleEvent(
          input.transport,
          relayConnectionReadyEvent,
          timeouts.connectTimeoutMs,
          (payload) => normalizeRelayConnectionReady(payload, input.payloadFrameSigning),
        );
    const streamPullWindowSize = resolveAdaptiveStreamPullWindowSize({
      configured: input.streamPullWindowSize,
      agentRecommended:
        input.agentRecommendedStreamPullWindowSize ??
        extractRecommendedStreamPullWindowSize(connectionReady),
      agentMax:
        input.agentMaxStreamPullWindowSize ??
        extractMaxStreamPullWindowSize(connectionReady),
    });
    plugLogger.debug("transport.socket.connected", {
      agentId: input.agentId,
      ...(connectionReady ? { socketId: connectionReady.id } : { reused: true }),
    });

    if (!conversationId) {
      const conversationPromise = waitForRelaySingleEvent(
        input.transport,
        relayConversationStartedEvent,
        timeouts.commandTimeoutMs,
        normalizeRelayConversationStarted,
      );
      input.transport.emit(relayConversationStartEvent, {
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
    } else {
      plugLogger.debug("transport.socket.conversation_reused", {
        agentId: input.agentId,
        conversationId,
      });
    }

    const outboundFrame = await encodePayloadFrameAsync(command, {
      requestId: clientRequestId,
      compression: input.payloadFrameCompression ?? "default",
      signing: input.payloadFrameSigning,
    });

    const acceptedStatePromise = fastPath
      ? Promise.resolve(buildSyntheticAcceptedState(conversationId, clientRequestId))
      : waitForRelaySingleEvent(
          input.transport,
          relayRpcAcceptedEvent,
          timeouts.commandTimeoutMs,
          normalizeRelayAcceptedPayload,
        ).then((payload) => assertRelayAcceptedPayload(payload));

    const streamAggregationPromise = waitForRelayStreamAggregation({
      transport: input.transport,
      conversationId,
      clientRequestId,
      acceptedStatePromise,
      responseMode: input.responseMode,
      payloadFrameSigning: input.payloadFrameSigning,
      streamPullWindowSize,
      fastPath,
      timeouts,
      limits,
    });

    const relayFailurePromise = fastPath
      ? waitForRelayAcceptedFailure(input.transport)
      : undefined;

    input.transport.emit(relayRpcRequestEvent, {
      conversationId,
      frame: outboundFrame,
      ...(input.payloadFrameCompression !== undefined
        ? { payloadFrameCompression: input.payloadFrameCompression }
        : {}),
      ...(input.requestServerTimings === true ? { requestServerTimings: true } : {}),
      ...(fastPath ? { fastPath: true } : {}),
    });

    const streamOutcome = await Promise.race(
      relayFailurePromise
        ? [streamAggregationPromise, relayFailurePromise]
        : [
            streamAggregationPromise,
            acceptedStatePromise.then(
              () =>
                new Promise<Awaited<typeof streamAggregationPromise>>(() => {
                  // Accepted succeeded; stream aggregation resolves the command.
                }),
              (error: unknown) => Promise.reject(error),
            ),
          ],
    );

    let accepted = await acceptedStatePromise;

    if (fastPath) {
      const hubRequestId = streamOutcome.result.responseFrame.requestId;
      if (typeof hubRequestId === "string" && hubRequestId.trim() !== "") {
        accepted = {
          ...accepted,
          requestId: hubRequestId,
        };
      }
    }

    const {
      result: finalResponse,
      metrics: streamMetrics,
      chunkPayloads,
      rawChunkFrames,
      rawCompleteFrame,
    } = streamOutcome;

    if (!fastPath || accepted.deduplicated || accepted.inFlight) {
      if (accepted.inFlight) {
        plugLogger.info("transport.socket.request_accepted.in_flight", {
          agentId: input.agentId,
          conversationId,
          requestId: accepted.requestId,
          clientRequestId: accepted.clientRequestId,
        });
      }
      if (accepted.deduplicated) {
        plugLogger.info("transport.socket.request_accepted.deduplicated", {
          agentId: input.agentId,
          conversationId,
          requestId: accepted.requestId,
          clientRequestId: accepted.clientRequestId,
          replayed: accepted.replayed,
        });
      }
    }

    const serverTimings = extractServerTimings(finalResponse.responsePayload);

    const buildMetrics = (): SocketCommandRuntimeMetrics => ({
      ignoredCommandResponses: streamMetrics.ignoredResponses,
      ignoredStreamChunks: streamMetrics.ignoredChunks,
      ignoredStreamCompletes: streamMetrics.ignoredCompletes,
      ignoredStreamPullResponses: 0,
      streamPullRequests: streamMetrics.pullCount,
      streamChunks: streamMetrics.chunkCount,
      bufferedBytes: streamMetrics.bufferedBytes,
      bufferedRows: streamMetrics.bufferedRows,
      ...(serverTimings ? { serverTimings } : {}),
      ...(fastPath ? { fastPath: true } : {}),
      ...(input.requestServerTimings === true ? { requestServerTimings: true } : {}),
    });

    plugLogger.debug("transport.socket.request_accepted", {
      agentId: input.agentId,
      conversationId,
      requestId: accepted.requestId,
      clientRequestId: accepted.clientRequestId,
      deduplicated: accepted.deduplicated,
      replayed: accepted.replayed,
      inFlight: accepted.inFlight,
      fastPath,
      requestServerTimings: input.requestServerTimings === true,
      chunkCount: streamMetrics.chunkCount,
      bufferedBytes: streamMetrics.bufferedBytes,
      bufferedRows: streamMetrics.bufferedRows,
      ...(serverTimings ? { serverTimings } : {}),
    });
    const connectedAfterMs = Date.now() - commandStartMs;

    return {
      channel: "socket",
      socketMode: "relay",
      agentId: input.agentId,
      requestId: accepted.requestId,
      notification: false,
      conversationId,
      accepted: fastPath ? undefined : accepted,
      ...(connectionReady ? { connectionReady } : {}),
      response: normalizeRpcPayload(finalResponse.responsePayload),
      rawResponsePayload: finalResponse.responsePayload,
      chunkPayloads,
      completePayload: finalResponse.completePayload,
      rawResponseFrame: finalResponse.responseFrame,
      rawChunkFrames,
      rawCompleteFrame: rawCompleteFrame ?? finalResponse.completeFrame,
      metrics: buildMetrics(),
      executionMetrics: {
        connectedAfterMs,
        ...(serverTimings ? { serverTimings } : {}),
      },
    };
  } finally {
    if (conversationId && input.skipConversationEnd !== true) {
      input.transport.emit(relayConversationEndEvent, { conversationId });
    }
    if (!managedTransport) {
      input.transport.disconnect();
    }
  }
};
