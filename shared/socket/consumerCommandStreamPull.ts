import type {
  ConsumerCommandStreamPullResponsePayload,
  JsonObject,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugTimeoutError } from "../contracts/errors";
import {
  createConsumerConnectError,
  createConsumerControlError,
  createConsumerDisconnectError,
  createConsumerSocketAppError,
} from "./consumerCommandSessionErrors";
import {
  consumerSocketAppErrorEvent,
  consumerSocketConnectErrorEvent,
  consumerSocketDisconnectEvent,
  consumerSocketStreamPullEvent,
  consumerSocketStreamPullResponseEvent,
  maxConsumerStreamPullWindowSize,
} from "./consumerCommandSessionConstants";
import type { ConsumerSocketTransport } from "./consumerCommandSessionTypes";
import {
  decodeConsumerCommandWirePayload,
  normalizeConsumerStreamPullResponse,
} from "./consumerCommandWire";
import { DEFAULT_CONSUMER_SOCKET_PULL_WINDOW } from "../contracts/api";
import { createSettleOnce } from "./socketSessionLifecycle";

export const normalizeConsumerStreamPullWindowSize = (
  value: unknown,
  fallback: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(maxConsumerStreamPullWindowSize, Math.max(1, Math.floor(value)));
};

export const matchesConsumerCommandRequest = (
  payload: {
    readonly requestId?: string;
    readonly clientRequestId?: string;
  },
  requestId: string,
): boolean => payload.requestId === requestId || payload.clientRequestId === requestId;

export const matchesConsumerStreamPullResponse = (
  response: ConsumerCommandStreamPullResponsePayload,
  requestId: string,
  streamId: string,
): boolean => {
  if (response.success) {
    return (
      typeof response.requestId === "string" &&
      response.requestId === requestId &&
      typeof response.streamId === "string" &&
      response.streamId === streamId
    );
  }

  if (response.requestId !== undefined && response.requestId !== requestId) {
    return false;
  }

  if (response.streamId !== undefined && response.streamId !== streamId) {
    return false;
  }

  return true;
};

export const matchesConsumerStreamPayload = (
  payload: JsonObject,
  activeRequestId: string,
  commandRequestId: string,
  activeStreamId: string | undefined,
  toRequestId: (value: unknown) => string | undefined,
): boolean => {
  const requestId = toRequestId(payload.request_id);
  if (requestId !== activeRequestId && requestId !== commandRequestId) {
    return false;
  }

  return (
    activeStreamId === undefined ||
    typeof payload.stream_id !== "string" ||
    payload.stream_id === activeStreamId
  );
};

export const requestConsumerStreamPull = async (
  transport: ConsumerSocketTransport,
  requestId: string,
  streamId: string,
  timeoutMs: number,
  windowSize = DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  onIgnoredResponse?: (payload: ConsumerCommandStreamPullResponsePayload) => void,
  signing?: PayloadFrameSigningOptions,
): Promise<number> => {
  const normalizedWindowSize = normalizeConsumerStreamPullWindowSize(
    windowSize,
    DEFAULT_CONSUMER_SOCKET_PULL_WINDOW,
  );
  const settle = createSettleOnce();

  return new Promise<number>((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined;

    const cleanup = (): void => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      transport.off(consumerSocketStreamPullResponseEvent, handlePullResponse);
      transport.off(consumerSocketAppErrorEvent, handleAppError);
      transport.off(consumerSocketConnectErrorEvent, handleConnectError);
      transport.off(consumerSocketDisconnectEvent, handleDisconnect);
    };

    const handlePullResponse = (payload: unknown): void => {
      void (async () => {
        if (settle.isSettled()) {
          return;
        }

        try {
          const decodedPayload = await decodeConsumerCommandWirePayload(payload, signing);
          const response = normalizeConsumerStreamPullResponse(decodedPayload);
          if (!matchesConsumerStreamPullResponse(response, requestId, streamId)) {
            onIgnoredResponse?.(response);
            return;
          }

          if (!response.success) {
            cleanup();
            settle.settleOnce(
              reject,
              createConsumerControlError({
                code: response.error.code,
                message: response.error.message,
                statusCode: response.error.statusCode,
                retryAfterMs: response.error.retryAfterMs,
                details: response.rateLimit
                  ? { rateLimit: response.rateLimit }
                  : undefined,
              }),
            );
            return;
          }

          cleanup();
          settle.settleOnce(
            resolve,
            normalizeConsumerStreamPullWindowSize(
              response.windowSize,
              normalizedWindowSize,
            ),
          );
        } catch (error: unknown) {
          cleanup();
          settle.settleOnce(reject, error);
        }
      })();
    };

    const handleAppError = (payload: unknown): void => {
      cleanup();
      settle.settleOnce(reject, createConsumerSocketAppError(payload));
    };

    const handleConnectError = (payload: unknown): void => {
      cleanup();
      settle.settleOnce(reject, createConsumerConnectError(payload));
    };

    const handleDisconnect = (payload: unknown): void => {
      cleanup();
      settle.settleOnce(reject, createConsumerDisconnectError(payload));
    };

    timer = setTimeout(() => {
      cleanup();
      settle.settleOnce(
        reject,
        new PlugTimeoutError("Timed out while waiting for agents:stream_pull_response", {
          timeoutMs,
          eventName: consumerSocketStreamPullResponseEvent,
          requestId,
          streamId,
        }),
      );
    }, timeoutMs);

    transport.on(consumerSocketStreamPullResponseEvent, handlePullResponse);
    transport.on(consumerSocketAppErrorEvent, handleAppError);
    transport.on(consumerSocketConnectErrorEvent, handleConnectError);
    transport.on(consumerSocketDisconnectEvent, handleDisconnect);
    transport.emit(consumerSocketStreamPullEvent, {
      requestId,
      streamId,
      windowSize: normalizedWindowSize,
    });
  });
};
