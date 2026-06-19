import {
  DEFAULT_RELAY_PULL_WINDOW,
  type RelayStreamPullResponsePayload,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugTimeoutError } from "../contracts/errors";
import { encodePayloadFrameAsync } from "./payloadFrameCodec";
import {
  relayAppErrorEvent,
  relayConnectErrorEvent,
  relayDisconnectEvent,
  relayMaxStreamPullWindowSize,
  relayRpcStreamPullEvent,
  relayRpcStreamPullResponseEvent,
} from "./relaySessionConstants";
import {
  createRelayConnectError,
  createRelayControlError,
  createRelayDisconnectError,
  createRelaySocketAppError,
} from "./relaySessionErrors";
import {
  normalizeRelayStreamPullResponse,
  normalizeRelayStreamPullWindowSize,
} from "./relaySessionNormalization";
import type { RelaySocketTransport } from "./relaySessionTypes";

export const requestRelayStreamPull = async (
  transport: RelaySocketTransport,
  conversationId: string,
  requestId: string,
  streamId: string,
  timeoutMs: number,
  signing?: PayloadFrameSigningOptions,
  windowSize = DEFAULT_RELAY_PULL_WINDOW,
): Promise<number> => {
  const normalizedWindowSize = normalizeRelayStreamPullWindowSize(
    windowSize,
    DEFAULT_RELAY_PULL_WINDOW,
    relayMaxStreamPullWindowSize,
  );
  const frame = await encodePayloadFrameAsync(
    {
      stream_id: streamId,
      request_id: requestId,
      window_size: normalizedWindowSize,
    },
    {
      requestId,
      omitTraceId: true,
      compression: "default",
      signing,
    },
  );

  const response = await new Promise<RelayStreamPullResponsePayload>(
    (resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        transport.off(relayRpcStreamPullResponseEvent, handlePullResponse);
        transport.off(relayAppErrorEvent, handleAppError);
        transport.off(relayConnectErrorEvent, handleConnectError);
        transport.off(relayDisconnectEvent, handleDisconnect);
      };

      const handlePullResponse = (payload: unknown): void => {
        try {
          const response = normalizeRelayStreamPullResponse(payload);
          if (
            response.success &&
            (response.conversationId !== conversationId ||
              response.requestId !== requestId ||
              response.streamId !== streamId)
          ) {
            return;
          }

          cleanup();
          resolve(response);
        } catch (error: unknown) {
          cleanup();
          reject(error);
        }
      };

      const handleAppError = (payload: unknown): void => {
        cleanup();
        reject(createRelaySocketAppError(payload));
      };

      const handleConnectError = (payload: unknown): void => {
        cleanup();
        reject(createRelayConnectError(payload));
      };

      const handleDisconnect = (payload: unknown): void => {
        cleanup();
        reject(createRelayDisconnectError(payload));
      };

      const timer = setTimeout(() => {
        cleanup();
        reject(
          new PlugTimeoutError(
            "Timed out while waiting for relay:rpc.stream.pull_response",
            {
              timeoutMs,
              eventName: relayRpcStreamPullResponseEvent,
              conversationId,
              requestId,
              streamId,
            },
          ),
        );
      }, timeoutMs);

      transport.on(relayRpcStreamPullResponseEvent, handlePullResponse);
      transport.on(relayAppErrorEvent, handleAppError);
      transport.on(relayConnectErrorEvent, handleConnectError);
      transport.on(relayDisconnectEvent, handleDisconnect);
      transport.emit(relayRpcStreamPullEvent, {
        conversationId,
        frame,
      });
    },
  );

  if (!response.success) {
    throw createRelayControlError({
      code: response.error?.code ?? "RELAY_STREAM_PULL_FAILED",
      message: response.error?.message ?? "relay:rpc.stream.pull failed",
      statusCode: response.error?.statusCode,
      retryAfterMs: response.error?.retryAfterMs,
      details: response.rateLimit ? { rateLimit: response.rateLimit } : undefined,
    });
  }

  return typeof response.windowSize === "number" && response.windowSize > 0
    ? normalizeRelayStreamPullWindowSize(
        response.windowSize,
        normalizedWindowSize,
        relayMaxStreamPullWindowSize,
      )
    : normalizedWindowSize;
};
