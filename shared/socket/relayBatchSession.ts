import type {
  PlugCommandTransportResult,
  RelayRpcBatchAcceptedItemSuccess,
  RpcSingleCommand,
  SocketCommandRuntimeMetrics,
} from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { normalizeRpcPayload } from "../output/rpcNormalization";
import { decodePayloadFrameAsync, encodePayloadFrameAsync } from "./payloadFrameCodec";
import {
  relayConnectionReadyEvent,
  relayConversationEndEvent,
  relayConversationStartEvent,
  relayConversationStartedEvent,
  relayRpcBatchAcceptedEvent,
  relayRpcRequestBatchEvent,
  relayRpcResponseEvent,
} from "./relaySessionConstants";
import { createRelayControlError } from "./relaySessionErrors";
import {
  assertRelayBatchAcceptedPayload,
  ensureRelayCompatibleCommand,
  extractServerTimings,
  normalizeRelayBatchAcceptedPayload,
  normalizeRelayConnectionReady,
  normalizeRelayConversationStarted,
} from "./relaySessionNormalization";
import { waitForRelaySingleEvent } from "./relaySessionWait";
import type { ExecuteRelayCommandInput, RelaySocketTransport } from "./relaySessionTypes";
import { resolveAdaptiveStreamPullWindowSize } from "./streamPullWindowPolicy";
import { resolveSocketBufferLimits } from "./streamCommandSessionCommon";
import {
  buildSocketCommandTimeoutError,
  resolveSocketCommandTimeouts,
} from "./socketSessionLifecycle";

export const MAX_RELAY_BATCH_COMMANDS = 32;

const buildBatchMetrics = (
  serverTimings: import("../contracts/api").PlugServerTimings | undefined,
  requestServerTimings: boolean | undefined,
): SocketCommandRuntimeMetrics => ({
  ignoredCommandResponses: 0,
  ignoredStreamChunks: 0,
  ignoredStreamCompletes: 0,
  ignoredStreamPullResponses: 0,
  streamPullRequests: 0,
  streamChunks: 0,
  bufferedBytes: 0,
  bufferedRows: 0,
  ...(serverTimings ? { serverTimings } : {}),
  ...(requestServerTimings === true ? { requestServerTimings: true } : {}),
});

export interface ExecuteRelayBatchCommandInput extends Omit<
  ExecuteRelayCommandInput,
  | "command"
  | "fastPath"
  | "agentRecommendedStreamPullWindowSize"
  | "agentMaxStreamPullWindowSize"
> {
  readonly commands: readonly RpcSingleCommand[];
  readonly agentRecommendedStreamPullWindowSize?: number;
  readonly agentMaxStreamPullWindowSize?: number;
}

export interface RelayBatchCommandItemResult {
  readonly clientRequestId: string;
  readonly requestId: string;
  readonly response: PlugCommandTransportResult;
}

const ensureRelayBatchCommands = (
  commands: readonly RpcSingleCommand[],
): RpcSingleCommand[] => {
  if (commands.length === 0) {
    throw new PlugValidationError("Relay batch requires at least one JSON-RPC command.");
  }

  if (commands.length > MAX_RELAY_BATCH_COMMANDS) {
    throw new PlugValidationError(
      `Relay batch supports at most ${MAX_RELAY_BATCH_COMMANDS} JSON-RPC commands.`,
    );
  }

  const normalized = commands.map((command) => ensureRelayCompatibleCommand(command));
  const seenIds = new Set<string>();
  for (const command of normalized) {
    const clientRequestId = String(command.id);
    if (seenIds.has(clientRequestId)) {
      throw new PlugValidationError(
        "Relay batch commands must use unique JSON-RPC id values.",
      );
    }
    seenIds.add(clientRequestId);
  }

  return normalized;
};

const isBatchAcceptedSuccessItem = (
  item: import("../contracts/api").RelayRpcBatchAcceptedItem,
): item is RelayRpcBatchAcceptedItemSuccess => "requestId" in item;

export const executeRelayBatchCommand = async (
  input: ExecuteRelayBatchCommandInput,
): Promise<readonly RelayBatchCommandItemResult[]> => {
  const commands = ensureRelayBatchCommands(input.commands);
  const timeouts = resolveSocketCommandTimeouts({ timeoutMs: input.timeoutMs });
  resolveSocketBufferLimits(input.bufferLimits);
  let conversationId: string | undefined = input.reusedConversationId;
  const managedTransport = input.managedTransport === true;

  if (!managedTransport || !input.transport.connected) {
    input.transport.connect();
  }

  try {
    if (!input.transport.connected) {
      await waitForRelaySingleEvent(
        input.transport,
        relayConnectionReadyEvent,
        timeouts.connectTimeoutMs,
        (payload) => normalizeRelayConnectionReady(payload, input.payloadFrameSigning),
      );
    }

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
    }

    const outboundFrame = await encodePayloadFrameAsync(commands, {
      compression: input.payloadFrameCompression ?? "default",
      signing: input.payloadFrameSigning,
    });

    const batchAcceptedPromise = waitForRelaySingleEvent(
      input.transport,
      relayRpcBatchAcceptedEvent,
      timeouts.commandTimeoutMs,
      normalizeRelayBatchAcceptedPayload,
    );

    const pendingResponses = new Map<
      string,
      {
        readonly item: RelayRpcBatchAcceptedItemSuccess;
        readonly resolve: (value: {
          readonly item: RelayRpcBatchAcceptedItemSuccess;
          readonly payload: unknown;
        }) => void;
        readonly reject: (error: unknown) => void;
      }
    >();
    const bufferedResponses = new Map<string, unknown>();

    const responseListener = (payload: unknown): void => {
      void (async () => {
        try {
          const decoded = await decodePayloadFrameAsync<unknown>(payload, {
            signing: input.payloadFrameSigning,
          });
          const requestId = decoded.frame.requestId;
          if (typeof requestId !== "string") {
            return;
          }

          const pending = pendingResponses.get(requestId);
          if (pending) {
            pendingResponses.delete(requestId);
            pending.resolve({ item: pending.item, payload: decoded.data });
            if (pendingResponses.size === 0) {
              input.transport.off(relayRpcResponseEvent, responseListener);
            }
            return;
          }

          bufferedResponses.set(requestId, decoded.data);
        } catch {
          // Ignore unrelated frames until timeout handles failures.
        }
      })();
    };

    input.transport.on(relayRpcResponseEvent, responseListener);

    input.transport.emit(relayRpcRequestBatchEvent, {
      conversationId,
      frame: outboundFrame,
      ...(input.payloadFrameCompression !== undefined
        ? { payloadFrameCompression: input.payloadFrameCompression }
        : {}),
      ...(input.requestServerTimings === true ? { requestServerTimings: true } : {}),
    });

    const batchAccepted = assertRelayBatchAcceptedPayload(await batchAcceptedPromise);
    const acceptedItems = batchAccepted.items.filter(isBatchAcceptedSuccessItem);

    await Promise.resolve();

    const responses = await Promise.all(
      acceptedItems.map(
        (item) =>
          new Promise<{
            readonly item: RelayRpcBatchAcceptedItemSuccess;
            readonly payload: unknown;
          }>((resolve, reject) => {
            const buffered = bufferedResponses.get(item.requestId);
            if (buffered !== undefined) {
              bufferedResponses.delete(item.requestId);
              resolve({ item, payload: buffered });
              return;
            }

            pendingResponses.set(item.requestId, { item, resolve, reject });
            setTimeout(() => {
              if (!pendingResponses.has(item.requestId)) {
                return;
              }

              pendingResponses.delete(item.requestId);
              reject(
                buildSocketCommandTimeoutError({
                  message: "Timed out while waiting for relay batch RPC response",
                  timeoutMs: timeouts.commandTimeoutMs,
                  eventName: relayRpcResponseEvent,
                  details: {
                    requestId: item.requestId,
                    clientRequestId: item.clientRequestId,
                    conversationId,
                  },
                }),
              );
            }, timeouts.commandTimeoutMs);
          }),
      ),
    );

    input.transport.off(relayRpcResponseEvent, responseListener);

    plugLogger.debug("transport.socket.batch_completed", {
      agentId: input.agentId,
      conversationId,
      batchSize: batchAccepted.batchSize,
      resolvedCount: responses.length,
      streamPullWindowSize: resolveAdaptiveStreamPullWindowSize({
        configured: input.streamPullWindowSize,
        agentRecommended: input.agentRecommendedStreamPullWindowSize,
        agentMax: input.agentMaxStreamPullWindowSize,
      }),
    });

    return responses.map(({ item, payload }) => {
      const serverTimings = extractServerTimings(payload);
      const metrics = buildBatchMetrics(serverTimings, input.requestServerTimings);
      return {
        clientRequestId: item.clientRequestId,
        requestId: item.requestId,
        response: {
          channel: "socket",
          socketMode: "relay",
          agentId: input.agentId,
          requestId: item.requestId,
          notification: false,
          conversationId,
          accepted: {
            success: true,
            conversationId: conversationId as string,
            requestId: item.requestId,
            clientRequestId: item.clientRequestId,
            deduplicated: item.deduplicated,
            replayed: item.replayed,
            inFlight: item.inFlight,
          },
          response: normalizeRpcPayload(payload),
          rawResponsePayload: payload,
          chunkPayloads: [],
          rawChunkFrames: [],
          metrics,
          ...(serverTimings ? { executionMetrics: { serverTimings } } : {}),
        },
      };
    });
  } finally {
    if (conversationId && input.skipConversationEnd !== true) {
      input.transport.emit(relayConversationEndEvent, { conversationId });
    }
    if (!managedTransport) {
      input.transport.disconnect();
    }
  }
};

export type { RelaySocketTransport };
