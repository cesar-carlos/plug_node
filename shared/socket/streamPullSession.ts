import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugTimeoutError } from "../contracts/errors";
import { encodePayloadFrame } from "./payloadFrameCodec";
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
import { DEFAULT_RELAY_PULL_WINDOW } from "../contracts/api";

type PendingPull = {
  readonly conversationId: string;
  readonly requestId: string;
  readonly streamId: string;
  readonly resolve: (windowSize: number) => void;
  readonly reject: (error: unknown) => void;
  readonly timer: NodeJS.Timeout;
};

const pullKey = (conversationId: string, requestId: string, streamId: string): string =>
  `${conversationId}\0${requestId}\0${streamId}`;

export interface RelayStreamPullSessionOptions {
  readonly signing?: PayloadFrameSigningOptions;
  /**
   * When false, skip app:error / connect_error / disconnect listeners.
   * Use when the parent aggregation session already owns those terminal events.
   */
  readonly attachTerminalListeners?: boolean;
}

export interface RelayStreamPullSession {
  readonly requestPull: (input: {
    readonly conversationId: string;
    readonly requestId: string;
    readonly streamId: string;
    readonly timeoutMs: number;
    readonly windowSize?: number;
  }) => Promise<number>;
  readonly dispose: () => void;
}

export const createRelayStreamPullSession = (
  transport: RelaySocketTransport,
  signingOrOptions?: PayloadFrameSigningOptions | RelayStreamPullSessionOptions,
): RelayStreamPullSession => {
  const options: RelayStreamPullSessionOptions =
    signingOrOptions !== undefined &&
    ("signing" in signingOrOptions || "attachTerminalListeners" in signingOrOptions)
      ? signingOrOptions
      : { signing: signingOrOptions as PayloadFrameSigningOptions | undefined };
  const signing = options.signing;
  const attachTerminalListeners = options.attachTerminalListeners !== false;

  const pending = new Map<string, PendingPull>();
  let disposed = false;

  const rejectPending = (error: unknown): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    pending.clear();
  };

  const handlePullResponse = (payload: unknown): void => {
    try {
      const response = normalizeRelayStreamPullResponse(payload);
      if (!response.success) {
        // Match against any pending with same ids when present; otherwise ignore.
        for (const [key, entry] of pending) {
          if (
            (response.requestId !== undefined &&
              response.requestId !== entry.requestId) ||
            (response.streamId !== undefined && response.streamId !== entry.streamId)
          ) {
            continue;
          }

          clearTimeout(entry.timer);
          pending.delete(key);
          entry.reject(
            createRelayControlError({
              code: response.error?.code ?? "RELAY_STREAM_PULL_FAILED",
              message: response.error?.message ?? "relay:rpc.stream.pull failed",
              statusCode: response.error?.statusCode,
              retryAfterMs: response.error?.retryAfterMs,
              details: response.rateLimit ? { rateLimit: response.rateLimit } : undefined,
            }),
          );
          return;
        }
        return;
      }

      if (
        typeof response.conversationId !== "string" ||
        typeof response.requestId !== "string" ||
        typeof response.streamId !== "string"
      ) {
        return;
      }

      const key = pullKey(response.conversationId, response.requestId, response.streamId);
      const entry = pending.get(key);
      if (!entry) {
        return;
      }

      clearTimeout(entry.timer);
      pending.delete(key);
      const windowSize =
        typeof response.windowSize === "number" && response.windowSize > 0
          ? normalizeRelayStreamPullWindowSize(
              response.windowSize,
              DEFAULT_RELAY_PULL_WINDOW,
              relayMaxStreamPullWindowSize,
            )
          : DEFAULT_RELAY_PULL_WINDOW;
      entry.resolve(windowSize);
    } catch (error: unknown) {
      // Malformed pull_response for an in-flight pull should fail the command.
      if (pending.size > 0) {
        rejectPending(error);
      }
    }
  };

  const handleAppError = (payload: unknown): void => {
    rejectPending(createRelaySocketAppError(payload));
  };
  const handleConnectError = (payload: unknown): void => {
    rejectPending(createRelayConnectError(payload));
  };
  const handleDisconnect = (payload: unknown): void => {
    rejectPending(createRelayDisconnectError(payload));
  };

  transport.on(relayRpcStreamPullResponseEvent, handlePullResponse);
  if (attachTerminalListeners) {
    transport.on(relayAppErrorEvent, handleAppError);
    transport.on(relayConnectErrorEvent, handleConnectError);
    transport.on(relayDisconnectEvent, handleDisconnect);
  }

  return {
    async requestPull(input): Promise<number> {
      if (disposed) {
        throw createRelayControlError({
          code: "RELAY_STREAM_PULL_FAILED",
          message: "Stream pull session already disposed",
        });
      }

      const normalizedWindowSize = normalizeRelayStreamPullWindowSize(
        input.windowSize,
        DEFAULT_RELAY_PULL_WINDOW,
        relayMaxStreamPullWindowSize,
      );
      // Tiny control frames: sync encode avoids async scheduling overhead.
      const frame = encodePayloadFrame(
        {
          stream_id: input.streamId,
          request_id: input.requestId,
          window_size: normalizedWindowSize,
        },
        {
          requestId: input.requestId,
          omitTraceId: true,
          compression: "none",
          signing,
        },
      );

      const key = pullKey(input.conversationId, input.requestId, input.streamId);
      return new Promise<number>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(key);
          reject(
            new PlugTimeoutError(
              "Timed out while waiting for relay:rpc.stream.pull_response",
              {
                timeoutMs: input.timeoutMs,
                eventName: relayRpcStreamPullResponseEvent,
                conversationId: input.conversationId,
                requestId: input.requestId,
                streamId: input.streamId,
              },
            ),
          );
        }, input.timeoutMs);

        pending.set(key, {
          conversationId: input.conversationId,
          requestId: input.requestId,
          streamId: input.streamId,
          resolve,
          reject,
          timer,
        });

        transport.emit(relayRpcStreamPullEvent, {
          conversationId: input.conversationId,
          frame,
        });
      }).then((windowSize) =>
        normalizeRelayStreamPullWindowSize(
          windowSize,
          normalizedWindowSize,
          relayMaxStreamPullWindowSize,
        ),
      );
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      transport.off(relayRpcStreamPullResponseEvent, handlePullResponse);
      if (attachTerminalListeners) {
        transport.off(relayAppErrorEvent, handleAppError);
        transport.off(relayConnectErrorEvent, handleConnectError);
        transport.off(relayDisconnectEvent, handleDisconnect);
      }
      for (const entry of pending.values()) {
        clearTimeout(entry.timer);
        entry.reject(
          createRelayControlError({
            code: "RELAY_STREAM_PULL_FAILED",
            message: "Stream pull session disposed",
          }),
        );
      }
      pending.clear();
    },
  };
};
