import { registerSocketCommand } from "./socketEventDispatcher";
import { resolveCommandTimeoutPolicy } from "./commandTimeoutPolicy";
import { randomUUID } from "node:crypto";

import type {
  JsonObject,
  PlugCommandTransportResult,
  RelayRpcBatchAcceptedItemSuccess,
  RpcSingleCommand,
  SocketCommandRuntimeMetrics,
  SocketTransportResult,
} from "../contracts/api";
import type { PayloadFrameEnvelope } from "../contracts/payload-frame";
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
import {
  createRelayControlError,
  createRelaySocketAppError,
  createRelayDisconnectError,
  createRelayConnectError,
} from "./relaySessionErrors";
import {
  assertRelayBatchAcceptedPayload,
  ensureRelayCompatibleCommand,
  extractRpcBodyId,
  extractServerTimings,
  getStreamIdFromNormalizedResponse,
  normalizeRelayBatchAcceptedPayload,
  normalizeRelayConnectionReady,
  normalizeRelayConversationStarted,
} from "./relaySessionNormalization";
import { waitForRelaySingleEvent } from "./relaySessionWait";
import type { ExecuteRelayCommandInput, RelaySocketTransport } from "./relaySessionTypes";
import {
  waitForRelayStreamAggregation,
  type RelayStreamAggregationMetrics,
} from "./relayStreamAggregation";
import { resolveAdaptiveStreamPullWindowSize } from "./streamPullWindowPolicy";
import { resolveSocketBufferLimits } from "./streamCommandSessionCommon";
import { buildSocketCommandTimeoutError } from "./socketSessionLifecycle";

export const MAX_RELAY_BATCH_COMMANDS = 32;

const buildBatchMetrics = (
  serverTimings: import("../contracts/api").PlugServerTimings | undefined,
  requestServerTimings: boolean | undefined,
  options?: {
    readonly fastPath?: boolean;
    readonly stream?: RelayStreamAggregationMetrics;
  },
): SocketCommandRuntimeMetrics => ({
  ignoredCommandResponses: options?.stream?.ignoredResponses ?? 0,
  ignoredStreamChunks: options?.stream?.ignoredChunks ?? 0,
  ignoredStreamCompletes: options?.stream?.ignoredCompletes ?? 0,
  ignoredStreamPullResponses: 0,
  streamPullRequests: options?.stream?.pullCount ?? 0,
  streamChunks: options?.stream?.chunkCount ?? 0,
  bufferedBytes: options?.stream?.bufferedBytes ?? 0,
  bufferedRows: options?.stream?.bufferedRows ?? 0,
  ...(serverTimings ? { serverTimings } : {}),
  ...(options?.fastPath === true ? { fastPath: true } : {}),
  ...(requestServerTimings === true ? { requestServerTimings: true } : {}),
});

type DecodedBatchItemResponse = {
  readonly clientRequestId: string;
  readonly requestId: string;
  readonly frame: PayloadFrameEnvelope;
  readonly data: unknown;
  readonly acceptedItem?: RelayRpcBatchAcceptedItemSuccess;
};

export interface ExecuteRelayBatchCommandInput extends Omit<
  ExecuteRelayCommandInput,
  "command" | "agentRecommendedStreamPullWindowSize" | "agentMaxStreamPullWindowSize"
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

const isBatchAcceptedFailureItem = (
  item: import("../contracts/api").RelayRpcBatchAcceptedItem,
): item is import("../contracts/api").RelayRpcBatchAcceptedItemFailure =>
  "error" in item && !("requestId" in item);

const buildAcceptedFailureBatchResult = (
  input: {
    readonly agentId: string;
    readonly conversationId: string;
    readonly requestServerTimings: boolean | undefined;
    readonly fastPath: boolean;
  },
  failure: import("../contracts/api").RelayRpcBatchAcceptedItemFailure,
): RelayBatchCommandItemResult => {
  const response: SocketTransportResult = {
    channel: "socket",
    socketMode: "relay",
    agentId: input.agentId,
    requestId: failure.clientRequestId,
    notification: false,
    conversationId: input.conversationId,
    response: {
      type: "single",
      success: false,
      item: {
        id: failure.clientRequestId,
        success: false,
        error: {
          code: -32000,
          message: failure.error.message,
          data: {
            code: failure.error.code,
            ...(failure.error.statusCode !== undefined
              ? { statusCode: failure.error.statusCode }
              : {}),
            ...(failure.error.itemIndex !== undefined
              ? { itemIndex: failure.error.itemIndex }
              : {}),
          },
        },
      },
    },
    rawResponsePayload: {
      id: failure.clientRequestId,
      error: failure.error,
    },
    chunkPayloads: [],
    rawChunkFrames: [],
    metrics: buildBatchMetrics(undefined, input.requestServerTimings, {
      fastPath: input.fastPath,
    }),
  };

  return {
    clientRequestId: failure.clientRequestId,
    requestId: failure.clientRequestId,
    response,
  };
};

const waitForRelayBatchAcceptedFailure = (
  transport: RelaySocketTransport,
): { readonly promise: Promise<never>; readonly cancel: () => void } => {
  let handleAccepted: ((payload: unknown) => void) | undefined;

  const cancel = (): void => {
    if (handleAccepted) {
      transport.off(relayRpcBatchAcceptedEvent, handleAccepted);
      handleAccepted = undefined;
    }
  };

  const promise = new Promise<never>((_, reject) => {
    handleAccepted = (payload: unknown): void => {
      cancel();
      try {
        assertRelayBatchAcceptedPayload(normalizeRelayBatchAcceptedPayload(payload));
      } catch (error: unknown) {
        reject(error);
      }
    };

    transport.on(relayRpcBatchAcceptedEvent, handleAccepted);
  });

  return { promise, cancel };
};

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
  const timeouts = resolveCommandTimeoutPolicy({
    timeoutMs: input.timeoutMs,
    command: input.commands,
  });
  const limits = resolveSocketBufferLimits(input.bufferLimits);
  const streamPullWindowSize = resolveAdaptiveStreamPullWindowSize({
    configured: input.streamPullWindowSize,
    agentRecommended: input.agentRecommendedStreamPullWindowSize,
    agentMax: input.agentMaxStreamPullWindowSize,
  });
  let conversationId: string | undefined = input.reusedConversationId;
  const managedTransport = input.managedTransport === true;
  const fastPath = input.fastPath === true;
  let commandSucceeded = false;
  const clientRequestIds = new Set(commands.map((command) => String(command.id)));
  const wireSession = registerSocketCommand({
    transport: input.transport,
    ids: [...clientRequestIds],
    agentId: input.agentId,
    conversationId: input.reusedConversationId,
    signing: input.payloadFrameSigning,
    bufferLimits: input.bufferLimits,
  });
  const lifetimeAbort = new AbortController();
  const signal = input.signal
    ? AbortSignal.any([input.signal, lifetimeAbort.signal])
    : lifetimeAbort.signal;
  input = {
    ...input,
    transport: wireSession.transport,
    payloadFrameSigning: wireSession.signing,
    signal,
  };

  try {
    const readyPromise = input.transport.connected
      ? undefined
      : waitForRelaySingleEvent(
          input.transport,
          relayConnectionReadyEvent,
          timeouts.connectTimeoutMs,
          (payload) => normalizeRelayConnectionReady(payload, input.payloadFrameSigning),
          signal,
        );
    void readyPromise?.catch(() => undefined);
    if (!managedTransport || !input.transport.connected) input.transport.connect();
    await readyPromise;

    if (!conversationId) {
      const conversationPromise = waitForRelaySingleEvent(
        input.transport,
        relayConversationStartedEvent,
        timeouts.commandTimeoutMs,
        normalizeRelayConversationStarted,
        signal,
      );
      input.transport.emit(relayConversationStartEvent, {
        requestId: randomUUID(),
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

    const batchFailureWaiter = fastPath
      ? waitForRelayBatchAcceptedFailure(input.transport)
      : undefined;

    const pendingClassicResponses = new Map<
      string,
      {
        readonly item: RelayRpcBatchAcceptedItemSuccess;
        readonly resolve: (value: DecodedBatchItemResponse) => void;
        readonly reject: (error: unknown) => void;
      }
    >();
    const bufferedClassicResponses = new Map<string, DecodedBatchItemResponse>();

    const pendingFastPathResponses = new Map<
      string,
      {
        readonly resolve: (value: DecodedBatchItemResponse) => void;
        readonly reject: (error: unknown) => void;
      }
    >();
    const bufferedFastPathResponses = new Map<string, DecodedBatchItemResponse>();

    const responseListener = (payload: unknown): Promise<void> => {
      return (async () => {
        try {
          const decoded = await decodePayloadFrameAsync<unknown>(payload, {
            signing: input.payloadFrameSigning,
          });

          if (fastPath) {
            const clientRequestId = extractRpcBodyId(decoded.data);
            if (clientRequestId === undefined) {
              throw new PlugValidationError(
                "Relay fast-path response requires a JSON-RPC id.",
              );
            }
            if (!clientRequestIds.has(clientRequestId)) {
              return;
            }

            const requestId = resolveHubRequestId(
              decoded.frame.requestId,
              clientRequestId,
            );
            const decodedItem: DecodedBatchItemResponse = {
              clientRequestId,
              requestId,
              frame: decoded.frame,
              data: decoded.data,
            };
            const pending = pendingFastPathResponses.get(clientRequestId);
            if (pending) {
              pendingFastPathResponses.delete(clientRequestId);
              pending.resolve(decodedItem);
              return;
            }

            // Cap early buffering to the batch size to avoid unbounded growth.
            if (bufferedFastPathResponses.size < commands.length) {
              bufferedFastPathResponses.set(clientRequestId, decodedItem);
            }
            return;
          }

          const requestId = decoded.frame.requestId;
          if (typeof requestId !== "string") {
            return;
          }

          const pending = pendingClassicResponses.get(requestId);
          if (pending) {
            pendingClassicResponses.delete(requestId);
            pending.resolve({
              clientRequestId: pending.item.clientRequestId,
              requestId,
              frame: decoded.frame,
              data: decoded.data,
              acceptedItem: pending.item,
            });
            return;
          }

          if (bufferedClassicResponses.size < commands.length) {
            bufferedClassicResponses.set(requestId, {
              clientRequestId: "",
              requestId,
              frame: decoded.frame,
              data: decoded.data,
            });
          }
        } catch (error) {
          rejectFailure(error);
        }
      })();
    };

    const responseWaitTimers = new Set<NodeJS.Timeout>();
    let rejectFailure!: (error: unknown) => void;
    const failurePromise = new Promise<never>((_, reject) => {
      rejectFailure = reject;
    });
    void failurePromise.catch(() => undefined);
    const onAppError = (payload: unknown): void =>
      rejectFailure(createRelaySocketAppError(payload));
    const onDisconnect = (payload: unknown): void =>
      rejectFailure(createRelayDisconnectError(payload));
    const onConnectError = (payload: unknown): void =>
      rejectFailure(createRelayConnectError(payload));
    const onAbort = (): void =>
      rejectFailure(signal.reason ?? new Error("Relay batch cancelled"));
    input.transport.on("app:error", onAppError);
    input.transport.on("disconnect", onDisconnect);
    input.transport.on("connect_error", onConnectError);
    signal.addEventListener("abort", onAbort, { once: true });
    const batchAcceptedPromise = fastPath
      ? undefined
      : waitForRelaySingleEvent(
          input.transport,
          relayRpcBatchAcceptedEvent,
          timeouts.commandTimeoutMs,
          normalizeRelayBatchAcceptedPayload,
          signal,
        );
    void batchAcceptedPromise?.catch(() => undefined);

    input.transport.on(relayRpcResponseEvent, responseListener);

    input.transport.emit(relayRpcRequestBatchEvent, {
      conversationId,
      frame: outboundFrame,
      ...(input.payloadFrameCompression !== undefined
        ? { payloadFrameCompression: input.payloadFrameCompression }
        : {}),
      ...(input.requestServerTimings === true ? { requestServerTimings: true } : {}),
      ...(fastPath ? { fastPath: true } : {}),
      timeoutMs: timeouts.hubWaitTimeoutMs,
    });

    let responses: DecodedBatchItemResponse[];
    const acceptedFailures: import("../contracts/api").RelayRpcBatchAcceptedItemFailure[] =
      [];

    try {
      if (fastPath) {
        const waitAllResponses = Promise.all(
          commands.map(
            (command) =>
              new Promise<DecodedBatchItemResponse>((resolve, reject) => {
                const clientRequestId = String(command.id);
                const buffered = bufferedFastPathResponses.get(clientRequestId);
                if (buffered !== undefined) {
                  bufferedFastPathResponses.delete(clientRequestId);
                  resolve(buffered);
                  return;
                }

                pendingFastPathResponses.set(clientRequestId, { resolve, reject });
                const timer = setTimeout(() => {
                  responseWaitTimers.delete(timer);
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
                responseWaitTimers.add(timer);
              }),
          ),
        );

        try {
          responses = await Promise.race(
            batchFailureWaiter
              ? [waitAllResponses, batchFailureWaiter.promise, failurePromise]
              : [waitAllResponses, failurePromise],
          );
        } finally {
          batchFailureWaiter?.cancel();
        }
      } else {
        const batchAccepted = assertRelayBatchAcceptedPayload(
          await Promise.race([batchAcceptedPromise!, failurePromise]),
        );

        const acceptedByClientRequestId = new Map(
          batchAccepted.items.map((item) => [item.clientRequestId, item] as const),
        );

        responses = [];
        const successWaiters: Array<Promise<DecodedBatchItemResponse>> = [];

        for (const command of commands) {
          const clientRequestId = String(command.id);
          const acceptedItem = acceptedByClientRequestId.get(clientRequestId);
          if (!acceptedItem) {
            acceptedFailures.push({
              clientRequestId,
              error: {
                code: "RELAY_BATCH_ITEM_MISSING",
                message: `Relay batch accept omitted clientRequestId "${clientRequestId}".`,
              },
            });
            continue;
          }

          if (isBatchAcceptedFailureItem(acceptedItem)) {
            acceptedFailures.push(acceptedItem);
            continue;
          }

          if (!isBatchAcceptedSuccessItem(acceptedItem)) {
            acceptedFailures.push({
              clientRequestId,
              error: {
                code: "RELAY_BATCH_ITEM_INVALID",
                message: `Relay batch accept item for "${clientRequestId}" is invalid.`,
              },
            });
            continue;
          }

          successWaiters.push(
            new Promise<DecodedBatchItemResponse>((resolve, reject) => {
              const buffered = bufferedClassicResponses.get(acceptedItem.requestId);
              if (buffered !== undefined) {
                bufferedClassicResponses.delete(acceptedItem.requestId);
                resolve({
                  ...buffered,
                  clientRequestId: acceptedItem.clientRequestId,
                  acceptedItem,
                });
                return;
              }

              pendingClassicResponses.set(acceptedItem.requestId, {
                item: acceptedItem,
                resolve,
                reject,
              });
              const timer = setTimeout(() => {
                responseWaitTimers.delete(timer);
                if (!pendingClassicResponses.has(acceptedItem.requestId)) {
                  return;
                }

                pendingClassicResponses.delete(acceptedItem.requestId);
                reject(
                  buildSocketCommandTimeoutError({
                    message: "Timed out while waiting for relay batch RPC response",
                    timeoutMs: timeouts.commandTimeoutMs,
                    eventName: relayRpcResponseEvent,
                    details: {
                      requestId: acceptedItem.requestId,
                      clientRequestId: acceptedItem.clientRequestId,
                      conversationId,
                    },
                  }),
                );
              }, timeouts.commandTimeoutMs);
              responseWaitTimers.add(timer);
            }),
          );
        }

        responses = await Promise.race([Promise.all(successWaiters), failurePromise]);
      }
    } finally {
      signal.removeEventListener("abort", onAbort);
      input.transport.off("app:error", onAppError);
      input.transport.off("disconnect", onDisconnect);
      input.transport.off("connect_error", onConnectError);
      // Always detach the shared response listener and clear timers, even on timeout.
      input.transport.off(relayRpcResponseEvent, responseListener);
      for (const timer of responseWaitTimers) {
        clearTimeout(timer);
      }
      responseWaitTimers.clear();
      for (const pending of pendingFastPathResponses.values())
        pending.reject(new Error("Relay batch response wait closed"));
      for (const pending of pendingClassicResponses.values())
        pending.reject(new Error("Relay batch response wait closed"));
      pendingFastPathResponses.clear();
      pendingClassicResponses.clear();
      bufferedClassicResponses.clear();
      bufferedFastPathResponses.clear();
    }

    const finalizeBatchItem = async (
      decoded: DecodedBatchItemResponse,
    ): Promise<RelayBatchCommandItemResult> => {
      const streamId = getStreamIdFromNormalizedResponse(decoded.data);
      let responsePayload = decoded.data;
      let chunkPayloads: JsonObject[] = [];
      let rawChunkFrames: PayloadFrameEnvelope[] = [];
      let completePayload: JsonObject | undefined;
      let rawResponseFrame: PayloadFrameEnvelope | undefined = decoded.frame;
      let rawCompleteFrame: PayloadFrameEnvelope | undefined;
      let streamMetrics: RelayStreamAggregationMetrics | undefined;

      if (streamId) {
        const acceptedStatePromise = Promise.resolve({
          success: true as const,
          conversationId: conversationId as string,
          requestId: decoded.requestId,
          clientRequestId: decoded.clientRequestId,
          ...(decoded.acceptedItem?.deduplicated !== undefined
            ? { deduplicated: decoded.acceptedItem.deduplicated }
            : {}),
          ...(decoded.acceptedItem?.replayed !== undefined
            ? { replayed: decoded.acceptedItem.replayed }
            : {}),
          ...(decoded.acceptedItem?.inFlight !== undefined
            ? { inFlight: decoded.acceptedItem.inFlight }
            : {}),
        });

        const streamOutcome = await waitForRelayStreamAggregation({
          transport: input.transport,
          canReceive: wireSession.canReceive,
          drainDelivery: wireSession.drain,
          signal,
          conversationId: conversationId as string,
          clientRequestId: decoded.clientRequestId,
          acceptedStatePromise,
          responseMode: input.responseMode,
          payloadFrameSigning: input.payloadFrameSigning,
          streamPullWindowSize,
          // Hub requestId is already known from the response frame.
          fastPath: true,
          timeouts,
          limits,
          seededResponse: {
            frame: decoded.frame,
            data: decoded.data,
          },
        });

        responsePayload = streamOutcome.result.responsePayload;
        chunkPayloads = streamOutcome.chunkPayloads;
        rawChunkFrames = streamOutcome.rawChunkFrames;
        completePayload = streamOutcome.result.completePayload;
        rawResponseFrame = streamOutcome.result.responseFrame;
        rawCompleteFrame =
          streamOutcome.rawCompleteFrame ?? streamOutcome.result.completeFrame;
        streamMetrics = streamOutcome.metrics;
      }

      const serverTimings = extractServerTimings(responsePayload);
      const metrics = buildBatchMetrics(serverTimings, input.requestServerTimings, {
        fastPath,
        stream: streamMetrics,
      });

      const response: SocketTransportResult = {
        channel: "socket",
        socketMode: "relay",
        agentId: input.agentId,
        requestId: decoded.requestId,
        notification: false,
        conversationId,
        ...(decoded.acceptedItem
          ? {
              accepted: {
                success: true as const,
                conversationId: conversationId as string,
                requestId: decoded.requestId,
                clientRequestId: decoded.clientRequestId,
                deduplicated: decoded.acceptedItem.deduplicated,
                replayed: decoded.acceptedItem.replayed,
                inFlight: decoded.acceptedItem.inFlight,
              },
            }
          : {}),
        response: normalizeRpcPayload(responsePayload),
        rawResponsePayload: responsePayload,
        chunkPayloads,
        ...(completePayload !== undefined ? { completePayload } : {}),
        ...(rawResponseFrame !== undefined ? { rawResponseFrame } : {}),
        rawChunkFrames,
        ...(rawCompleteFrame !== undefined ? { rawCompleteFrame } : {}),
        metrics,
        ...(serverTimings ? { executionMetrics: { serverTimings } } : {}),
      };

      return {
        clientRequestId: decoded.clientRequestId,
        requestId: decoded.requestId,
        response,
      };
    };

    const successResults = await Promise.all(responses.map(finalizeBatchItem));
    const failureResults = acceptedFailures.map((failure) =>
      buildAcceptedFailureBatchResult(
        {
          agentId: input.agentId,
          conversationId: conversationId as string,
          requestServerTimings: input.requestServerTimings,
          fastPath,
        },
        failure,
      ),
    );

    const resultsByClientRequestId = new Map<string, RelayBatchCommandItemResult>();
    for (const result of [...successResults, ...failureResults]) {
      resultsByClientRequestId.set(result.clientRequestId, result);
    }

    const batchResults = commands.map((command) => {
      const clientRequestId = String(command.id);
      const result = resultsByClientRequestId.get(clientRequestId);
      if (!result) {
        return buildAcceptedFailureBatchResult(
          {
            agentId: input.agentId,
            conversationId: conversationId as string,
            requestServerTimings: input.requestServerTimings,
            fastPath,
          },
          {
            clientRequestId,
            error: {
              code: "RELAY_BATCH_ITEM_MISSING",
              message: `Relay batch did not resolve clientRequestId "${clientRequestId}".`,
            },
          },
        );
      }
      return result;
    });

    plugLogger.debug("transport.socket.batch_completed", {
      agentId: input.agentId,
      conversationId,
      batchSize: commands.length,
      resolvedCount: batchResults.length,
      acceptedFailureCount: acceptedFailures.length,
      fastPath,
      streamPullWindowSize,
      streamedItems: batchResults.filter(
        (item) =>
          ((item.response as SocketTransportResult).metrics?.streamChunks ?? 0) > 0,
      ).length,
    });

    commandSucceeded = true;
    return batchResults;
  } finally {
    // Keep conversation open across managed reuse only after success.
    // Failed batch commands must end so agent stream capacity is released.
    if (conversationId && (input.skipConversationEnd !== true || !commandSucceeded)) {
      input.transport.emit(relayConversationEndEvent, { conversationId });
    }
    if (!managedTransport) {
      input.transport.disconnect();
    }
    lifetimeAbort.abort();
    wireSession.dispose();
  }
};

export type { RelaySocketTransport };
