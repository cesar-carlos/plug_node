import { randomUUID } from "node:crypto";

import type { RelayConnectionReadyPayload } from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import {
  assertCustomSocketEventFramePayload,
  assertCustomSocketEventNames,
  assertSocketEventControlAck,
  defaultSocketEventAckTimeoutMs,
  type CustomSocketEventFramePayload,
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

export interface CustomSocketEventTransport {
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
  readonly onEvent: (event: CustomSocketEventFramePayload) => void | Promise<void>;
  readonly onFatalError: (error: PlugError) => void;
}

export interface CustomSocketEventSession {
  readonly eventNames: readonly string[];
  close(options?: { readonly unsubscribe?: boolean }): Promise<void>;
}

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

  return new PlugError(
    typeof appError.message === "string" && appError.message.trim() !== ""
      ? appError.message
      : "Plug socket reported an application error.",
    {
      code,
      details: isRecord(appError.details) ? appError.details : undefined,
      authRelated: code === "ACCOUNT_BLOCKED" || code === "AGENT_ACCESS_REVOKED",
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

export const startCustomSocketEventSession = async (
  input: StartCustomSocketEventSessionInput,
): Promise<CustomSocketEventSession> => {
  const eventNames = assertCustomSocketEventNames(input.eventNames);
  const timeoutMs = input.ackTimeoutMs ?? defaultSocketEventAckTimeoutMs;
  const subscribed = new Set<string>();
  const eventHandlers = new Map<string, (payload: unknown) => void>();
  let closing = false;

  await waitForConnectionReady(input.transport, timeoutMs, input.payloadFrameSigning);

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
      const handler = (payload: unknown): void => {
        void decodePayloadFrameAsync<unknown>(payload, {
          signing: input.payloadFrameSigning,
        })
          .then((decoded) => {
            const event = assertCustomSocketEventFramePayload(decoded.data);
            if (event.eventName !== eventName) {
              throw new PlugValidationError(
                "Custom socket event payload eventName does not match listener",
              );
            }

            return input.onEvent(event);
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
