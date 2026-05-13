import { randomUUID } from "node:crypto";

import type { RelayConnectionReadyPayload } from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import {
  assertAgentProfileUpdatedPayload,
  assertCustomSocketEventFramePayload,
  assertCustomSocketEventNames,
  assertCustomSocketEventName,
  assertPublishCustomSocketEventInput,
  assertPublishCustomSocketEventInputWithinLimits,
  assertSocketEventControlAck,
  assertSocketEventPublishedAck,
  clientAgentProfileUpdatedEventName,
  defaultSocketEventDeduplicationMaxEntries,
  defaultSocketEventAckTimeoutMs,
  type AgentProfileUpdatedPayload,
  type CustomSocketEventFramePayload,
  type PublishCustomSocketEventInput,
  type PublishCustomSocketEventResponse,
  type SocketEventRuntimeMetadata,
  type SocketEventPublishedAck,
  type SocketEventControlAck,
} from "../contracts/custom-socket-events";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";

const appErrorEvent = "app:error";
const connectErrorEvent = "connect_error";
const disconnectEvent = "disconnect";
const connectionReadyEvent = "connection:ready";
const subscribeEvent = "socket:event.subscribe";
const subscribedEvent = "socket:event.subscribed";
const unsubscribeEvent = "socket:event.unsubscribe";
const unsubscribedEvent = "socket:event.unsubscribed";
const publishEvent = "socket:event.publish";
const publishedEvent = "socket:event.published";

export interface CustomSocketEventTransport {
  readonly id?: string;
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface StartCustomSocketEventSessionInput {
  readonly transport: CustomSocketEventTransport;
  readonly eventNames: readonly string[];
  readonly ackTimeoutMs?: number;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly reconnectAttempt?: number;
  readonly requirePayloadSignature?: boolean;
  readonly deduplicateEventIdsTtlMs?: number;
  readonly onEvent: (
    event: CustomSocketEventFramePayload,
    metadata: SocketEventRuntimeMetadata,
  ) => void | Promise<void>;
  readonly onFatalError: (error: PlugError) => void;
}

export interface StartAgentProfileUpdatedSessionInput {
  readonly transport: CustomSocketEventTransport;
  readonly ackTimeoutMs?: number;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly reconnectAttempt?: number;
  readonly requirePayloadSignature?: boolean;
  readonly onEvent: (
    event: AgentProfileUpdatedPayload,
    metadata: SocketEventRuntimeMetadata,
  ) => void | Promise<void>;
  readonly onFatalError: (error: PlugError) => void;
}

export interface CustomSocketEventSession {
  readonly eventNames: readonly string[];
  close(options?: { readonly unsubscribe?: boolean }): Promise<void>;
}

const normalizeNonNegativeInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }

  return Math.floor(numeric);
};

const createEventIdDedupe = (
  ttlMs: number | undefined,
  maxEntries: number,
): ((eventId: string, nowMs: number) => boolean) => {
  if (ttlMs === undefined || ttlMs <= 0) {
    return () => false;
  }

  const seen = new Map<string, number>();

  return (eventId: string, nowMs: number): boolean => {
    const existingExpiresAt = seen.get(eventId);
    if (existingExpiresAt !== undefined && existingExpiresAt > nowMs) {
      return true;
    }

    seen.set(eventId, nowMs + ttlMs);
    for (const [cachedEventId, expiresAt] of seen) {
      if (expiresAt <= nowMs || seen.size > maxEntries) {
        seen.delete(cachedEventId);
      }
      if (seen.size <= maxEntries) {
        break;
      }
    }

    return false;
  };
};

const normalizeRetryAfterSeconds = (retryAfterMs: unknown): number | undefined => {
  if (
    typeof retryAfterMs !== "number" ||
    !Number.isFinite(retryAfterMs) ||
    retryAfterMs <= 0
  ) {
    return undefined;
  }

  return Math.max(1, Math.ceil(retryAfterMs / 1000));
};

const createSocketAppError = (payload: unknown): PlugError => {
  const appError = isRecord(payload) ? payload : {};
  const code =
    typeof appError.code === "string" && appError.code.trim() !== ""
      ? appError.code
      : "SOCKET_APP_ERROR";

  if (code === "ACCOUNT_BLOCKED") {
    return new PlugError("The Plug account is blocked.", {
      code,
      description:
        "The server closed the socket because the user or client account is blocked.",
      details: isRecord(appError.details) ? appError.details : undefined,
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
      details: isRecord(appError.details) ? appError.details : undefined,
      technicalMessage:
        typeof appError.message === "string" ? appError.message : undefined,
      authRelated: true,
    });
  }

  if (code === "NAMESPACE_DEPRECATED") {
    return new PlugError("The Plug socket namespace is deprecated.", {
      code,
      description: "Use the /consumers namespace for custom socket events.",
      details: isRecord(appError.details) ? appError.details : undefined,
      technicalMessage:
        typeof appError.message === "string" ? appError.message : undefined,
    });
  }

  return new PlugError(
    typeof appError.message === "string" && appError.message.trim() !== ""
      ? appError.message
      : "Plug socket reported an application error.",
    {
      code,
      details: isRecord(appError.details) ? appError.details : undefined,
      retryable:
        code === "CONSUMER_SOCKET_INITIALIZATION_FAILED" ||
        code === "ROOM_JOIN_FAILED" ||
        code === "SOCKET_APP_ERROR",
    },
  );
};

const createConnectError = (payload: unknown): PlugError => {
  const message =
    payload instanceof Error
      ? payload.message
      : typeof payload === "string"
        ? payload
        : "Socket connection failed";

  return new PlugError("Failed to connect to the Plug socket.", {
    code: "SOCKET_CONNECT_ERROR",
    description: "Run the workflow again to create a fresh socket connection.",
    technicalMessage: message,
    retryable: true,
  });
};

const createDisconnectError = (reason: unknown): PlugError =>
  new PlugError("The Plug socket disconnected while listening for custom events.", {
    code: "SOCKET_DISCONNECTED",
    description: "The workflow will need to reconnect before receiving more events.",
    technicalMessage: typeof reason === "string" ? reason : undefined,
    retryable: true,
  });

const createControlError = (
  ack: Extract<SocketEventControlAck, { success: false }>,
): PlugError => {
  const retryAfterSeconds = normalizeRetryAfterSeconds(ack.error.retryAfterMs);
  return new PlugError(ack.error.message, {
    code: ack.error.code,
    statusCode: ack.error.statusCode,
    retryable: ack.error.code === "RATE_LIMITED" || ack.error.statusCode === 429,
    retryAfterSeconds,
    details: ack.rateLimit ? { rateLimit: ack.rateLimit } : undefined,
  });
};

const createPublishedError = (
  ack: Extract<SocketEventPublishedAck, { success: false }>,
): PlugError => {
  const retryAfterSeconds = normalizeRetryAfterSeconds(ack.error.retryAfterMs);
  return new PlugError(ack.error.message, {
    code: ack.error.code,
    statusCode: ack.error.statusCode,
    retryable: ack.error.code === "RATE_LIMITED" || ack.error.statusCode === 429,
    retryAfterSeconds,
    details: ack.rateLimit ? { rateLimit: ack.rateLimit } : undefined,
  });
};

const withSigningPolicy = (
  signing: PayloadFrameSigningOptions | undefined,
  requirePayloadSignature: boolean | undefined,
): PayloadFrameSigningOptions | undefined => {
  if (!signing && !requirePayloadSignature) {
    return undefined;
  }

  return {
    ...(signing ?? {}),
    ...(requirePayloadSignature ? { requireSignature: true } : {}),
  };
};

const waitForConnectionReady = async (
  transport: CustomSocketEventTransport,
  timeoutMs: number,
  signing?: PayloadFrameSigningOptions,
): Promise<RelayConnectionReadyPayload> =>
  new Promise<RelayConnectionReadyPayload>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      transport.off(connectionReadyEvent, handleReady);
      transport.off(appErrorEvent, handleAppError);
      transport.off(connectErrorEvent, handleConnectError);
      transport.off(disconnectEvent, handleDisconnect);
    };

    const handleReady = (payload: unknown): void => {
      cleanup();
      void decodePayloadFrameAsync<RelayConnectionReadyPayload>(payload, {
        signing,
      }).then((decoded) => resolve(decoded.data), reject);
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError("Timed out while waiting for socket connection:ready", {
          timeoutMs,
          eventName: connectionReadyEvent,
        }),
      );
    }, timeoutMs);

    transport.on(connectionReadyEvent, handleReady);
    transport.on(appErrorEvent, handleAppError);
    transport.on(connectErrorEvent, handleConnectError);
    transport.on(disconnectEvent, handleDisconnect);
    transport.connect();
  });

const waitForControlAck = async (input: {
  readonly transport: CustomSocketEventTransport;
  readonly requestEvent: string;
  readonly responseEvent: string;
  readonly requestId: string;
  readonly eventName: string;
  readonly expectedSubscribed: boolean;
  readonly timeoutMs: number;
}): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      input.transport.off(input.responseEvent, handleAck);
      input.transport.off(appErrorEvent, handleAppError);
      input.transport.off(connectErrorEvent, handleConnectError);
      input.transport.off(disconnectEvent, handleDisconnect);
    };

    const handleAck = (payload: unknown): void => {
      try {
        const ack = assertSocketEventControlAck(payload);
        if (ack.success) {
          if (
            ack.requestId !== input.requestId ||
            ack.data.eventName !== input.eventName ||
            ack.data.subscribed !== input.expectedSubscribed
          ) {
            return;
          }

          cleanup();
          resolve();
          return;
        }

        if (ack.requestId !== input.requestId) {
          return;
        }

        cleanup();
        reject(createControlError(ack));
      } catch (error: unknown) {
        cleanup();
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError(`Timed out while waiting for ${input.responseEvent}`, {
          timeoutMs: input.timeoutMs,
          eventName: input.responseEvent,
          requestId: input.requestId,
          customEventName: input.eventName,
        }),
      );
    }, input.timeoutMs);

    input.transport.on(input.responseEvent, handleAck);
    input.transport.on(appErrorEvent, handleAppError);
    input.transport.on(connectErrorEvent, handleConnectError);
    input.transport.on(disconnectEvent, handleDisconnect);
    input.transport.emit(input.requestEvent, {
      requestId: input.requestId,
      eventName: input.eventName,
    });
  });

const waitForPublishedAck = async (input: {
  readonly transport: CustomSocketEventTransport;
  readonly requestId: string;
  readonly timeoutMs: number;
}): Promise<PublishCustomSocketEventResponse> =>
  new Promise<PublishCustomSocketEventResponse>((resolve, reject) => {
    const cleanup = (): void => {
      clearTimeout(timer);
      input.transport.off(publishedEvent, handleAck);
      input.transport.off(appErrorEvent, handleAppError);
      input.transport.off(connectErrorEvent, handleConnectError);
      input.transport.off(disconnectEvent, handleDisconnect);
    };

    const handleAck = (payload: unknown): void => {
      try {
        const ack = assertSocketEventPublishedAck(payload);
        if (ack.requestId !== input.requestId) {
          return;
        }

        cleanup();
        if (!ack.success) {
          reject(createPublishedError(ack));
          return;
        }

        resolve({
          success: true,
          eventId: ack.data.eventId,
          eventName: ack.data.eventName,
          recipients: ack.data.recipients,
          idempotentReplay: ack.data.idempotentReplay,
          ...(ack.data.idempotencyKey !== undefined
            ? { idempotencyKey: ack.data.idempotencyKey }
            : {}),
          requestId: ack.requestId,
        });
      } catch (error: unknown) {
        cleanup();
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createDisconnectError(payload));
    };

    const timer = setTimeout(() => {
      cleanup();
      reject(
        new PlugTimeoutError(`Timed out while waiting for ${publishedEvent}`, {
          timeoutMs: input.timeoutMs,
          eventName: publishedEvent,
          requestId: input.requestId,
        }),
      );
    }, input.timeoutMs);

    input.transport.on(publishedEvent, handleAck);
    input.transport.on(appErrorEvent, handleAppError);
    input.transport.on(connectErrorEvent, handleConnectError);
    input.transport.on(disconnectEvent, handleDisconnect);
  });

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

export const startCustomSocketEventSession = async (
  input: StartCustomSocketEventSessionInput,
): Promise<CustomSocketEventSession> => {
  const eventNames = assertCustomSocketEventNames(input.eventNames);
  const timeoutMs = input.ackTimeoutMs ?? defaultSocketEventAckTimeoutMs;
  const reconnectAttempt = Math.max(0, Math.floor(input.reconnectAttempt ?? 0));
  const dedupeTtlMs = normalizeNonNegativeInteger(input.deduplicateEventIdsTtlMs);
  const isDuplicateEventId = createEventIdDedupe(
    dedupeTtlMs,
    defaultSocketEventDeduplicationMaxEntries,
  );
  const subscribed = new Set<string>();
  const eventHandlers = new Map<string, (payload: unknown) => void>();
  let closing = false;

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
    notifyFatal(createSocketAppError(payload));
  };
  const handleConnectError = (payload: unknown): void => {
    notifyFatal(createConnectError(payload));
  };
  const handleDisconnect = (payload: unknown): void => {
    notifyFatal(createDisconnectError(payload));
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
        void decodePayloadFrameAsync<unknown>(payload, {
          signing: withSigningPolicy(
            input.payloadFrameSigning,
            input.requirePayloadSignature,
          ),
        })
          .then((decoded) => {
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

            return input.onEvent(event, {
              eventName,
              socketId: input.transport.id,
              reconnectAttempt,
              subscriptionCount: eventNames.length,
              payloadFrameRequestId:
                decoded.frame.requestId === null ? undefined : decoded.frame.requestId,
            });
          })
          .catch((error: unknown) => {
            notifyFatal(
              error instanceof PlugError
                ? error
                : new PlugError("Failed to process custom socket event.", {
                    code: "SOCKET_CUSTOM_EVENT_PROCESSING_FAILED",
                    technicalMessage: error instanceof Error ? error.message : undefined,
                  }),
            );
          });
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
    notifyFatal(createSocketAppError(payload));
  };
  const handleConnectError = (payload: unknown): void => {
    notifyFatal(createConnectError(payload));
  };
  const handleDisconnect = (payload: unknown): void => {
    notifyFatal(createDisconnectError(payload));
  };
  const handleProfileUpdated = (payload: unknown): void => {
    void decodePayloadFrameAsync<unknown>(payload, {
      signing: withSigningPolicy(
        input.payloadFrameSigning,
        input.requirePayloadSignature,
      ),
    })
      .then((decoded) =>
        input.onEvent(assertAgentProfileUpdatedPayload(decoded.data), {
          eventName: clientAgentProfileUpdatedEventName,
          socketId: input.transport.id,
          reconnectAttempt,
          subscriptionCount: 1,
          payloadFrameRequestId:
            decoded.frame.requestId === null ? undefined : decoded.frame.requestId,
        }),
      )
      .catch((error: unknown) => {
        notifyFatal(
          error instanceof PlugError
            ? error
            : new PlugError("Failed to process agent profile update event.", {
                code: "SOCKET_AGENT_PROFILE_EVENT_PROCESSING_FAILED",
                technicalMessage: error instanceof Error ? error.message : undefined,
              }),
        );
      });
  };

  input.transport.on(appErrorEvent, handleAppError);
  input.transport.on(connectErrorEvent, handleConnectError);
  input.transport.on(disconnectEvent, handleDisconnect);
  input.transport.on(clientAgentProfileUpdatedEventName, handleProfileUpdated);

  return {
    eventNames: [clientAgentProfileUpdatedEventName],
    close: async (): Promise<void> => {
      closing = true;
      input.transport.off(appErrorEvent, handleAppError);
      input.transport.off(connectErrorEvent, handleConnectError);
      input.transport.off(disconnectEvent, handleDisconnect);
      input.transport.off(clientAgentProfileUpdatedEventName, handleProfileUpdated);
      input.transport.disconnect();
    },
  };
};
