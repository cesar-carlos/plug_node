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
  extractRpcBodyId,
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
  fastPath?: boolean,
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
  ...(fastPath === true ? { fastPath: true } : {}),
  ...(requestServerTimings === true ? { requestServerTimings: true } : {}),
});

export interface ExecuteRelayBatchCommandInput extends Omit<
  ExecuteRelayCommandInput,
  | "command"
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

const waitForRelayBatchAcceptedFailure = (
  transport: RelaySocketTransport,
): Promise<never> =>
  new Promise<never>((_, reject) => {
    const handleAccepted = (payload: unknown): void => {
      transport.off(relayRpcBatchAcceptedEvent, handleAccepted);
      try {
        assertRelayBatchAcceptedPayload(normalizeRelayBatchAcceptedPayload(payload));
      } catch (error: unknown) {
        reject(error);
      }
    };

    transport.on(relayRpcBatchAcceptedEvent, handleAccepted);
  });

const resolveHubRequestId = (
  frameRequestId: string | null | undefined,
  clientRequestId: string,
): string =>
  typeof frameRequestId === "string" && frameRequestId.trim() !== ""
    ? frameRequestId
    : clientRequestId;

export const executeRelayBatchCommand = async (
  input: ExecuteRelayBatchCommandInput,
): Promise<readonly RelayBatchCommandItemResult[]> => {
  const commands = ensureRelayBatchCommands(input.commands);
  const timeouts = resolveSocketCommandTimeouts({ timeoutMs: input.timeoutMs });
  resolveSocketBufferLimits(input.bufferLimits);
  let conversationId: string | undefined = input.reusedConversationId;
  const managedTransport = input.managedTransport === true;
  const fastPath = input.fastPath === true;
  const clientRequestIds = new Set(commands.map((command) => String(command.id)));

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
      ...(fastPath ? { omitTraceId: true } : {}),
    });

    const batchFailurePromise = fastPath
      ? waitForRelayBatchAcceptedFailure(input.transport)
      : undefined;

    const pendingClassicResponses = new Map<
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
    const bufferedClassicResponses = new Map<string, unknown>();

    const pendingFastPathResponses = new Map<
      string,
      {
        readonly resolve: (value: {
          readonly clientRequestId: string;
          readonly requestId: string;
          readonly payload: unknown;
        }) => void;
        readonly reject: (error: unknown) => void;
      }
    >();
    const bufferedFastPathResponses = new Map<
      string,
      { readonly requestId: string; readonly payload: unknown }
    >();

    const responseListener = (payload: unknown): void => {
      void (async () => {
        try {
          const decoded = await decodePayloadFrameAsync<unknown>(payload, {
            signing: input.payloadFrameSigning,
          });

          if (fastPath) {
            const clientRequestId = extractRpcBodyId(decoded.data);
            if (
              clientRequestId === undefined ||
              !clientRequestIds.has(clientRequestId)
            ) {
              return;
            }

            const requestId = resolveHubRequestId(
              decoded.frame.requestId,
              clientRequestId,
            );
            const pending = pendingFastPathResponses.get(clientRequestId);
            if (pending) {
              pendingFastPathResponses.delete(clientRequestId);
              pending.resolve({ clientRequestId, requestId, payload: decoded.data });
              if (pendingFastPathResponses.size === 0) {
                input.transport.off(relayRpcResponseEvent, responseListener);
              }
              return;
            }

            bufferedFastPathResponses.set(clientRequestId, {
              requestId,
              payload: decoded.data,
            });
            return;
          }

          const requestId = decoded.frame.requestId;
          if (typeof requestId !== "string") {
            return;
          }

          const pending = pendingClassicResponses.get(requestId);
          if (pending) {
            pendingClassicResponses.delete(requestId);
            pending.resolve({ item: pending.item, payload: decoded.data });
            if (pendingClassicResponses.size === 0) {
              input.transport.off(relayRpcResponseEvent, responseListener);
            }
            return;
          }

          bufferedClassicResponses.set(requestId, decoded.data);
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
      ...(fastPath ? { fastPath: true } : {}),
    });

    let responses:
      | Array<{
          readonly item: RelayRpcBatchAcceptedItemSuccess;
          readonly payload: unknown;
        }>
      | Array<{
          readonly clientRequestId: string;
          readonly requestId: string;
          readonly payload: unknown;
        }>;

    if (fastPath) {
      const waitAllResponses = Promise.all(
        commands.map(
          (command) =>
            new Promise<{
              readonly clientRequestId: string;
              readonly requestId: string;
              readonly payload: unknown;
            }>((resolve, reject) => {
              const clientRequestId = String(command.id);
              const buffered = bufferedFastPathResponses.get(clientRequestId);
              if (buffered !== undefined) {
                bufferedFastPathResponses.delete(clientRequestId);
                resolve({
                  clientRequestId,
                  requestId: buffered.requestId,
                  payload: buffered.payload,
                });
                return;
              }

              pendingFastPathResponses.set(clientRequestId, { resolve, reject });
              setTimeout(() => {
                if (!pendingFastPathResponses.has(clientRequestId)) {
                  return;
                }

                pendingFastPathResponses.delete(clientRequestId);
                reject(
                  buildSocketCommandTimeoutError({
                    message: "Timed out while waiting for relay batch RPC response",
                    timeoutMs: timeouts.commandTimeoutMs,
                    eventName: relayRpcResponseEvent,
                    details: {
                      clientRequestId,
                      conversationId,
                    },
                  }),
                );
              }, timeouts.commandTimeoutMs);
            }),
        ),
      );

      responses = await Promise.race(
        batchFailurePromise
          ? [waitAllResponses, batchFailurePromise]
          : [waitAllResponses],
      );
    } else {
      const batchAccepted = assertRelayBatchAcceptedPayload(
        await waitForRelaySingleEvent(
          input.transport,
          relayRpcBatchAcceptedEvent,
          timeouts.commandTimeoutMs,
          normalizeRelayBatchAcceptedPayload,
        ),
      );
      const acceptedItems = batchAccepted.items.filter(isBatchAcceptedSuccessItem);

      await Promise.resolve();

      responses = await Promise.all(
        acceptedItems.map(
          (item) =>
            new Promise<{
              readonly item: RelayRpcBatchAcceptedItemSuccess;
              readonly payload: unknown;
            }>((resolve, reject) => {
              const buffered = bufferedClassicResponses.get(item.requestId);
              if (buffered !== undefined) {
                bufferedClassicResponses.delete(item.requestId);
                resolve({ item, payload: buffered });
                return;
              }

              pendingClassicResponses.set(item.requestId, { item, resolve, reject });
              setTimeout(() => {
                if (!pendingClassicResponses.has(item.requestId)) {
                  return;
                }

                pendingClassicResponses.delete(item.requestId);
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
    }

    input.transport.off(relayRpcResponseEvent, responseListener);

    plugLogger.debug("transport.socket.batch_completed", {
      agentId: input.agentId,
      conversationId,
      batchSize: commands.length,
      resolvedCount: responses.length,
      fastPath,
      streamPullWindowSize: resolveAdaptiveStreamPullWindowSize({
        configured: input.streamPullWindowSize,
        agentRecommended: input.agentRecommendedStreamPullWindowSize,
        agentMax: input.agentMaxStreamPullWindowSize,
      }),
    });

    if (fastPath) {
      return (
        responses as Array<{
          readonly clientRequestId: string;
          readonly requestId: string;
          readonly payload: unknown;
        }>
      ).map(({ clientRequestId, requestId, payload }) => {
        const serverTimings = extractServerTimings(payload);
        const metrics = buildBatchMetrics(
          serverTimings,
          input.requestServerTimings,
          true,
        );
        return {
          clientRequestId,
          requestId,
          response: {
            channel: "socket",
            socketMode: "relay",
            agentId: input.agentId,
            requestId,
            notification: false,
            conversationId,
            response: normalizeRpcPayload(payload),
            rawResponsePayload: payload,
            chunkPayloads: [],
            rawChunkFrames: [],
            metrics,
            ...(serverTimings ? { executionMetrics: { serverTimings } } : {}),
          },
        };
      });
    }

    return (
      responses as Array<{
        readonly item: RelayRpcBatchAcceptedItemSuccess;
        readonly payload: unknown;
      }>
    ).map(({ item, payload }) => {
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
