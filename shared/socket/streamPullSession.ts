import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugTimeoutError, PlugValidationError } from "../contracts/errors";
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
  readonly removeAbort: () => void;
};

const pullKey = (conversationId: string, requestId: string, streamId: string): string =>
  `${conversationId}\0${requestId}\0${streamId}`;

const activePullKeys = new WeakMap<RelaySocketTransport, Set<string>>();

export interface RelayStreamPullSessionOptions {
  readonly signing?: PayloadFrameSigningOptions;
  /**
   * When false, skip app:error / connect_error / disconnect listeners.
   * Use when the parent aggregation session already owns those terminal events.
   */
  readonly attachTerminalListeners?: boolean;
  readonly signal?: AbortSignal;
}

export interface RelayStreamPullSession {
  readonly requestPull: (input: {
    readonly conversationId: string;
    readonly requestId: string;
    readonly streamId: string;
    readonly timeoutMs: number;
    readonly windowSize?: number;
    readonly signal?: AbortSignal;
  }) => Promise<number>;
  readonly dispose: () => void;
}

export const createRelayStreamPullSession = (
  transport: RelaySocketTransport,
  signingOrOptions?: PayloadFrameSigningOptions | RelayStreamPullSessionOptions,
): RelayStreamPullSession => {
  const options: RelayStreamPullSessionOptions =
    signingOrOptions !== undefined &&
    ("signing" in signingOrOptions ||
      "attachTerminalListeners" in signingOrOptions ||
      "signal" in signingOrOptions)
      ? signingOrOptions
      : { signing: signingOrOptions as PayloadFrameSigningOptions | undefined };
  const signing = options.signing;
  const attachTerminalListeners = options.attachTerminalListeners !== false;

  const pending = new Map<string, PendingPull>();
  const activeKeys = activePullKeys.get(transport) ?? new Set<string>();
  activePullKeys.set(transport, activeKeys);
  let disposed = false;

  const rejectPending = (error: unknown): void => {
    for (const entry of pending.values()) {
      clearTimeout(entry.timer);
      entry.removeAbort();
      activeKeys.delete(pullKey(entry.conversationId, entry.requestId, entry.streamId));
      entry.reject(error);
    }
    pending.clear();
  };

  const handlePullResponse = (payload: unknown): void => {
    try {
      const response = normalizeRelayStreamPullResponse(payload);
      if (!response.success) {
        // An unidentified failure affects every pending pull in this session.
        for (const [key, entry] of pending) {
          if (
            (response.requestId !== undefined &&
              response.requestId !== entry.requestId) ||
            (response.conversationId !== undefined &&
              response.conversationId !== entry.conversationId) ||
            (response.streamId !== undefined && response.streamId !== entry.streamId)
          ) {
            continue;
          }

          clearTimeout(entry.timer);
          entry.removeAbort();
          pending.delete(key);
          activeKeys.delete(key);
          entry.reject(
            createRelayControlError({
              code: response.error?.code ?? "RELAY_STREAM_PULL_FAILED",
              message: response.error?.message ?? "relay:rpc.stream.pull failed",
              statusCode: response.error?.statusCode,
              retryAfterMs: response.error?.retryAfterMs,
              details: {
                commandDispatched: true,
                ...(response.rateLimit ? { rateLimit: response.rateLimit } : {}),
              },
            }),
          );
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
      entry.removeAbort();
      pending.delete(key);
      activeKeys.delete(key);
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
      if (activeKeys.has(key)) {
        throw new PlugValidationError(
          "A pull for this conversation, request and stream is already pending.",
        );
      }
      const signal = input.signal ?? options.signal;
      signal?.throwIfAborted();
      activeKeys.add(key);
      return new Promise<number>((resolve, reject) => {
        const handleAbort = (): void => {
          const entry = pending.get(key);
          if (!entry) return;
          clearTimeout(entry.timer);
          entry.removeAbort();
          pending.delete(key);
          activeKeys.delete(key);
          reject(signal?.reason ?? new Error("Stream pull cancelled"));
        };
        const removeAbort = (): void => signal?.removeEventListener("abort", handleAbort);
        const timer = setTimeout(() => {
          removeAbort();
          pending.delete(key);
          activeKeys.delete(key);
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
          removeAbort,
        });
        signal?.addEventListener("abort", handleAbort, { once: true });

        try {
          transport.emit(relayRpcStreamPullEvent, {
            conversationId: input.conversationId,
            frame,
          });
        } catch (error) {
          clearTimeout(timer);
          removeAbort();
          pending.delete(key);
          activeKeys.delete(key);
          reject(error);
        }
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
        entry.removeAbort();
        activeKeys.delete(pullKey(entry.conversationId, entry.requestId, entry.streamId));
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
