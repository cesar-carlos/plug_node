import { randomUUID } from "node:crypto";

import { DEFAULT_API_VERSION, SOCKET_PROTOCOL_VERSION } from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import {
  assertAgentProfileUpdatedPayload,
  assertCustomSocketEventFramePayload,
  assertCustomSocketEventNames,
  assertCustomSocketEventName,
  assertPublishCustomSocketEventInput,
  assertPublishCustomSocketEventInputWithinLimits,
  clientAgentProfileUpdatedEventName,
  defaultSocketEventAckTimeoutMs,
  type PublishCustomSocketEventInput,
  type PublishCustomSocketEventResponse,
} from "../contracts/custom-socket-events";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import {
  customSocketAppErrorEvent as appErrorEvent,
  customSocketConnectErrorEvent as connectErrorEvent,
  customSocketConsumerCommandEvent as consumerCommandEvent,
  customSocketDisconnectEvent as disconnectEvent,
  customSocketPublishEvent as publishEvent,
  customSocketSubscribeEvent as subscribeEvent,
  customSocketSubscribedEvent as subscribedEvent,
  customSocketUnsubscribeEvent as unsubscribeEvent,
  customSocketUnsubscribedEvent as unsubscribedEvent,
} from "./customSocketEventSessionConstants";
export type {
  CustomSocketEventSession,
  CustomSocketEventTransport,
  StartAgentProfileUpdatedSessionInput,
  StartCustomSocketEventSessionInput,
  WaitForCustomSocketEventInput,
  WaitForCustomSocketEventResult,
} from "./customSocketEventSessionTypes";
import type {
  CustomSocketEventSession,
  CustomSocketEventTransport,
  StartAgentProfileUpdatedSessionInput,
  StartCustomSocketEventSessionInput,
  WaitForCustomSocketEventInput,
  WaitForCustomSocketEventResult,
} from "./customSocketEventSessionTypes";
import {
  createCustomSocketAppError,
  createCustomSocketConnectError,
  createCustomSocketDisconnectError,
} from "./customSocketEventSessionErrors";
import {
  assertRequiredPayloadSigningKey,
  createConsumerIdleKeepalive,
  createEventIdDedupe,
  defaultCustomSocketEventDeduplicationMaxEntries,
  normalizeConsumerIdleKeepaliveIntervalMs,
  normalizeListenTimeoutMs,
  normalizeNonNegativeInteger,
  scheduleSocketEventTask,
  withSigningPolicy,
} from "./customSocketEventSessionSupport";
import {
  waitForConnectionReady,
  waitForControlAck,
  waitForPublishedAck,
} from "./customSocketEventSessionWait";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";

export const publishCustomSocketEventOverSocket = async (input: {
  readonly transport: CustomSocketEventTransport;
  readonly request: PublishCustomSocketEventInput;
  readonly ackTimeoutMs?: number;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly requirePayloadSignature?: boolean;
}): Promise<PublishCustomSocketEventResponse> => {
  const request = assertPublishCustomSocketEventInput(input.request);
  assertPublishCustomSocketEventInputWithinLimits(request);
  const timeoutMs =
    request.timeoutMs ?? input.ackTimeoutMs ?? defaultSocketEventAckTimeoutMs;
  const eventName = assertCustomSocketEventName(request.eventName);
  const requestId = randomUUID();

  try {
    const connectionReady = await waitForConnectionReady(
      input.transport,
      timeoutMs,
      withSigningPolicy(input.payloadFrameSigning, input.requirePayloadSignature),
    );

    const published = waitForPublishedAck({
      transport: input.transport,
      requestId,
      timeoutMs,
    });

    input.transport.emit(publishEvent, {
      requestId,
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      eventName,
      payload: request.payload,
      ...(request.payloadFrameCompression
        ? { payloadFrameCompression: request.payloadFrameCompression }
        : {}),
      ...(request.attachments && request.attachments.length > 0
        ? { attachments: request.attachments }
        : {}),
    });

    const response = await published;
    return {
      ...response,
      ...((input.transport.id ?? connectionReady.id)
        ? {
            publisherSocketId: input.transport.id ?? connectionReady.id,
          }
        : {}),
    };
  } finally {
    input.transport.disconnect();
  }
};

export const waitForCustomSocketEvent = async (
  input: WaitForCustomSocketEventInput,
): Promise<WaitForCustomSocketEventResult> => {
  const eventName = assertCustomSocketEventName(input.eventName);
  const listenTimeoutMs = normalizeListenTimeoutMs(input.listenTimeoutMs);
  assertRequiredPayloadSigningKey(
    input.payloadFrameSigning,
    input.requirePayloadSignature,
  );
  let session: CustomSocketEventSession | undefined;
  let timer: NodeJS.Timeout | undefined;
  let settled = false;

  const settleOnce = <T>(callback: (value: T) => void, value: T): void => {
    if (settled) {
      return;
    }

    settled = true;
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    callback(value);
  };

  try {
    return await new Promise<WaitForCustomSocketEventResult>((resolve, reject) => {
      startCustomSocketEventSession({
        transport: input.transport,
        eventNames: [eventName],
        ackTimeoutMs: input.ackTimeoutMs,
        payloadFrameSigning: input.payloadFrameSigning,
        requirePayloadSignature: input.requirePayloadSignature,
        onFatalError: (error) => {
          settleOnce(reject, error);
        },
        onEvent: (event, metadata) => {
          settleOnce(resolve, { event, metadata });
        },
      })
        .then((startedSession) => {
          session = startedSession;
          if (settled) {
            void session.close().catch((error: unknown) => {
              plugLogger.warn("transport.socket.custom_event.wait_close_failed", {
                eventName,
                code: error instanceof PlugError ? error.code : undefined,
              });
            });
            return;
          }

          timer = setTimeout(() => {
            settleOnce(
              reject,
              new PlugError("Timed out while waiting for Plug socket event.", {
                code: "SOCKET_EVENT_LISTEN_TIMEOUT",
                statusCode: 408,
                retryable: true,
                details: {
                  timeoutMs: listenTimeoutMs,
                  eventName,
                },
              }),
            );
          }, listenTimeoutMs);
        })
        .catch((error: unknown) => {
          settleOnce(reject, error);
        });
    });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
    await session?.close();
  }
};

export const startCustomSocketEventSession = async (
  input: StartCustomSocketEventSessionInput,
): Promise<CustomSocketEventSession> => {
  const eventNames = assertCustomSocketEventNames(input.eventNames);
  const timeoutMs = input.ackTimeoutMs ?? defaultSocketEventAckTimeoutMs;
  const reconnectAttempt = Math.max(0, Math.floor(input.reconnectAttempt ?? 0));
  const dedupeTtlMs = normalizeNonNegativeInteger(input.deduplicateEventIdsTtlMs);
  const isDuplicateEventId = createEventIdDedupe(
    dedupeTtlMs,
    defaultCustomSocketEventDeduplicationMaxEntries,
  );
  const subscribed = new Set<string>();
  const eventHandlers = new Map<string, (payload: unknown) => void>();
  let closing = false;
  let keepaliveSubscribeIndex = 0;
  const keepaliveIntervalMs = normalizeConsumerIdleKeepaliveIntervalMs(
    input.consumerIdleKeepaliveIntervalMs,
  );
  const keepalive = createConsumerIdleKeepalive({
    transport: input.transport,
    intervalMs: keepaliveIntervalMs,
    isActive: () => !closing,
    touch: () => {
      const eventName = eventNames[keepaliveSubscribeIndex % eventNames.length];
      keepaliveSubscribeIndex += 1;
      input.transport.emit(subscribeEvent, {
        requestId: randomUUID(),
        eventName,
      });
      plugLogger.debug("transport.socket.custom_event.keepalive", {
        touchEvent: subscribeEvent,
        eventName,
      });
    },
  });

  try {
    await waitForConnectionReady(
      input.transport,
      timeoutMs,
      withSigningPolicy(input.payloadFrameSigning, input.requirePayloadSignature),
    );
  } catch (error: unknown) {
    input.transport.disconnect();
    throw error;
  }

  const notifyFatal = (error: PlugError): void => {
    if (!closing) {
      input.onFatalError(error);
    }
  };

  const handleAppError = (payload: unknown): void => {
    notifyFatal(createCustomSocketAppError(payload));
  };
  const handleConnectError = (payload: unknown): void => {
    notifyFatal(createCustomSocketConnectError(payload));
  };
  const handleDisconnect = (payload: unknown): void => {
    notifyFatal(createCustomSocketDisconnectError(payload));
  };

  input.transport.on(appErrorEvent, handleAppError);
  input.transport.on(connectErrorEvent, handleConnectError);
  input.transport.on(disconnectEvent, handleDisconnect);

  const unsubscribeBestEffort = async (): Promise<void> => {
    for (const eventName of subscribed) {
      try {
        await waitForControlAck({
          transport: input.transport,
          requestEvent: unsubscribeEvent,
          responseEvent: unsubscribedEvent,
          requestId: randomUUID(),
          eventName,
          expectedSubscribed: false,
          timeoutMs,
        });
      } catch (error: unknown) {
        plugLogger.warn("transport.socket.custom_event.unsubscribe_failed", {
          eventName,
          code: error instanceof PlugError ? error.code : undefined,
        });
      }
    }
  };

  try {
    for (const eventName of eventNames) {
      const handler = (payload: unknown): void => {
        scheduleSocketEventTask(
          input.scheduleEvent,
          async () => {
            const decoded = await decodePayloadFrameAsync<unknown>(payload, {
              signing: withSigningPolicy(
                input.payloadFrameSigning,
                input.requirePayloadSignature,
              ),
            });
            const event = assertCustomSocketEventFramePayload(decoded.data);
            if (event.eventName !== eventName) {
              throw new PlugValidationError(
                "Custom socket event payload eventName does not match listener",
              );
            }
            if (isDuplicateEventId(event.eventId, Date.now())) {
              plugLogger.warn("transport.socket.custom_event.duplicate_ignored", {
                eventName,
                eventId: event.eventId,
              });
              return undefined;
            }

            await input.onEvent(event, {
              eventName,
              socketId: input.transport.id,
              reconnectAttempt,
              subscriptionCount: eventNames.length,
              payloadFrameRequestId:
                decoded.frame.requestId === null ? undefined : decoded.frame.requestId,
            });
          },
          (error: unknown) => {
            notifyFatal(
              error instanceof PlugError
                ? error
                : new PlugError("Failed to process custom socket event.", {
                    code: "SOCKET_CUSTOM_EVENT_PROCESSING_FAILED",
                    technicalMessage: error instanceof Error ? error.message : undefined,
                  }),
            );
          },
        );
      };

      input.transport.on(eventName, handler);
      eventHandlers.set(eventName, handler);

      await waitForControlAck({
        transport: input.transport,
        requestEvent: subscribeEvent,
        responseEvent: subscribedEvent,
        requestId: randomUUID(),
        eventName,
        expectedSubscribed: true,
        timeoutMs,
      });

      subscribed.add(eventName);
      plugLogger.info("transport.socket.custom_event.subscribed", {
        eventName,
      });
    }
  } catch (error: unknown) {
    closing = true;
    keepalive.stop();
    for (const [eventName, handler] of eventHandlers) {
      input.transport.off(eventName, handler);
    }
    await unsubscribeBestEffort();
    input.transport.off(appErrorEvent, handleAppError);
    input.transport.off(connectErrorEvent, handleConnectError);
    input.transport.off(disconnectEvent, handleDisconnect);
    input.transport.disconnect();
    throw error;
  }

  return {
    eventNames,
    close: async (options): Promise<void> => {
      closing = true;
      keepalive.stop();
      for (const [eventName, handler] of eventHandlers) {
        input.transport.off(eventName, handler);
      }

      if (options?.unsubscribe !== false && input.transport.connected) {
        await unsubscribeBestEffort();
      }

      input.transport.off(appErrorEvent, handleAppError);
      input.transport.off(connectErrorEvent, handleConnectError);
      input.transport.off(disconnectEvent, handleDisconnect);
      input.transport.disconnect();
    },
  };
};

export const startAgentProfileUpdatedSession = async (
  input: StartAgentProfileUpdatedSessionInput,
): Promise<CustomSocketEventSession> => {
  const timeoutMs = input.ackTimeoutMs ?? defaultSocketEventAckTimeoutMs;
  const reconnectAttempt = Math.max(0, Math.floor(input.reconnectAttempt ?? 0));
  let closing = false;
  const agentId = input.agentId?.trim();
  const keepaliveIntervalMs = normalizeConsumerIdleKeepaliveIntervalMs(
    input.consumerIdleKeepaliveIntervalMs,
  );
  const keepalive = createConsumerIdleKeepalive({
    transport: input.transport,
    intervalMs: keepaliveIntervalMs,
    isActive: () => !closing,
    touch: () => {
      if (!agentId) {
        plugLogger.warn("transport.socket.custom_event.keepalive_skipped", {
          reason: "missing_agent_id",
        });
        return;
      }

      input.transport.emit(consumerCommandEvent, {
        protocolVersion: SOCKET_PROTOCOL_VERSION,
        requestId: randomUUID(),
        clientRequestId: randomUUID(),
        agentId,
        command: {
          jsonrpc: "2.0",
          method: "rpc.discover",
          id: null,
          api_version: DEFAULT_API_VERSION,
        },
        timeoutMs: Math.min(timeoutMs, 5_000),
        payloadFrameCompression: "default",
      });
      plugLogger.debug("transport.socket.custom_event.keepalive", {
        touchEvent: consumerCommandEvent,
        agentId,
      });
    },
  });

  try {
    await waitForConnectionReady(
      input.transport,
      timeoutMs,
      withSigningPolicy(input.payloadFrameSigning, input.requirePayloadSignature),
    );
  } catch (error: unknown) {
    closing = true;
    keepalive.stop();
    input.transport.disconnect();
    throw error;
  }

  const notifyFatal = (error: PlugError): void => {
    if (!closing) {
      input.onFatalError(error);
    }
  };

  const handleAppError = (payload: unknown): void => {
    notifyFatal(createCustomSocketAppError(payload));
  };
  const handleConnectError = (payload: unknown): void => {
    notifyFatal(createCustomSocketConnectError(payload));
  };
  const handleDisconnect = (payload: unknown): void => {
    notifyFatal(createCustomSocketDisconnectError(payload));
  };
  const handleProfileUpdated = (payload: unknown): void => {
    scheduleSocketEventTask(
      input.scheduleEvent,
      async () => {
        const decoded = await decodePayloadFrameAsync<unknown>(payload, {
          signing: withSigningPolicy(
            input.payloadFrameSigning,
            input.requirePayloadSignature,
          ),
        });
        await input.onEvent(assertAgentProfileUpdatedPayload(decoded.data), {
          eventName: clientAgentProfileUpdatedEventName,
          socketId: input.transport.id,
          reconnectAttempt,
          subscriptionCount: 1,
          payloadFrameRequestId:
            decoded.frame.requestId === null ? undefined : decoded.frame.requestId,
        });
      },
      (error: unknown) => {
        notifyFatal(
          error instanceof PlugError
            ? error
            : new PlugError("Failed to process agent profile update event.", {
                code: "SOCKET_AGENT_PROFILE_EVENT_PROCESSING_FAILED",
                technicalMessage: error instanceof Error ? error.message : undefined,
              }),
        );
      },
    );
  };

  input.transport.on(appErrorEvent, handleAppError);
  input.transport.on(connectErrorEvent, handleConnectError);
  input.transport.on(disconnectEvent, handleDisconnect);
  input.transport.on(clientAgentProfileUpdatedEventName, handleProfileUpdated);

  return {
    eventNames: [clientAgentProfileUpdatedEventName],
    close: async (): Promise<void> => {
      closing = true;
      keepalive.stop();
      input.transport.off(appErrorEvent, handleAppError);
      input.transport.off(connectErrorEvent, handleConnectError);
      input.transport.off(disconnectEvent, handleDisconnect);
      input.transport.off(clientAgentProfileUpdatedEventName, handleProfileUpdated);
      input.transport.disconnect();
    },
  };
};
