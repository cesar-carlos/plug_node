import type { RelayConnectionReadyPayload } from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import {
  assertSocketEventControlAck,
  assertSocketEventPublishedAck,
  type PublishCustomSocketEventResponse,
} from "../contracts/custom-socket-events";
import { PlugTimeoutError } from "../contracts/errors";
import {
  customSocketAppErrorEvent as appErrorEvent,
  customSocketConnectErrorEvent as connectErrorEvent,
  customSocketConnectionReadyEvent as connectionReadyEvent,
  customSocketDisconnectEvent as disconnectEvent,
  customSocketPublishedEvent as publishedEvent,
} from "./customSocketEventSessionConstants";
import {
  createCustomSocketAppError,
  createCustomSocketConnectError,
  createCustomSocketControlError,
  createCustomSocketDisconnectError,
  createCustomSocketPublishedError,
} from "./customSocketEventSessionErrors";
import type { CustomSocketEventTransport } from "./customSocketEventSessionTypes";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";

export const waitForConnectionReady = async (
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
      reject(createCustomSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketDisconnectError(payload));
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

export const waitForControlAck = async (input: {
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
        reject(createCustomSocketControlError(ack));
      } catch (error: unknown) {
        cleanup();
        reject(error);
      }
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketDisconnectError(payload));
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

export const waitForPublishedAck = async (input: {
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
          reject(createCustomSocketPublishedError(ack));
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
      reject(createCustomSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      reject(createCustomSocketDisconnectError(payload));
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
