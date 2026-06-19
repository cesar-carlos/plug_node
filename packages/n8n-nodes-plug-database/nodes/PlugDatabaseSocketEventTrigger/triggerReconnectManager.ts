import { PlugError } from "../../generated/shared/contracts/errors";

import {
  createReconnectCircuitOpenError,
  defaultReconnectFailureWindowMs,
  defaultReconnectInitialDelayMs,
  defaultReconnectMaxDelayMs,
} from "./triggerHelpers";

export interface TriggerReconnectManagerConfig {
  readonly reconnectOnDisconnect: boolean;
  readonly maxReconnectAttempts: number;
  readonly reconnectInitialDelayMs?: number;
  readonly reconnectMaxDelayMs?: number;
  readonly reconnectFailureWindowMs?: number;
  readonly maxReconnectFailuresInWindow: number;
  readonly onFatalError: (error: PlugError) => void;
}

export class TriggerReconnectManager {
  private reconnectAttempts = 0;

  private reconnectFailureTimes: number[] = [];

  private reconnectTimer: NodeJS.Timeout | undefined;

  private reconnecting = false;

  private closed = false;

  private readonly config: TriggerReconnectManagerConfig;

  private readonly reconnectInitialDelayMs: number;

  private readonly reconnectMaxDelayMs: number;

  private readonly reconnectFailureWindowMs: number;

  constructor(config: TriggerReconnectManagerConfig) {
    this.config = config;
    this.reconnectInitialDelayMs =
      config.reconnectInitialDelayMs ?? defaultReconnectInitialDelayMs;
    this.reconnectMaxDelayMs = Math.max(
      this.reconnectInitialDelayMs,
      config.reconnectMaxDelayMs ?? defaultReconnectMaxDelayMs,
    );
    this.reconnectFailureWindowMs =
      config.reconnectFailureWindowMs ?? defaultReconnectFailureWindowMs;
  }

  markClosed(): void {
    this.closed = true;
    this.clearReconnectTimer();
  }

  clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = undefined;
    }
  }

  isReconnecting(): boolean {
    return this.reconnecting;
  }

  resetAttempts(): void {
    this.reconnectAttempts = 0;
    this.reconnectFailureTimes = [];
  }

  getReconnectAttempts(): number {
    return this.reconnectAttempts;
  }

  async connectWithRetry(connect: () => Promise<void>): Promise<void> {
    for (;;) {
      try {
        await connect();
        this.resetAttempts();
        return;
      } catch (error: unknown) {
        const plugError = error instanceof PlugError ? error : undefined;
        if (
          !plugError ||
          this.closed ||
          !this.config.reconnectOnDisconnect ||
          !plugError.retryable ||
          (this.config.maxReconnectAttempts > 0 &&
            this.reconnectAttempts >= this.config.maxReconnectAttempts)
        ) {
          throw error;
        }

        if (this.recordReconnectFailureAndIsCircuitOpen()) {
          throw createReconnectCircuitOpenError(plugError.message);
        }

        this.reconnectAttempts += 1;
        await this.delay(this.getReconnectDelayMs());
      }
    }
  }

  scheduleReconnect(error: PlugError, connect: () => Promise<void>): void {
    if (this.closed || !this.config.reconnectOnDisconnect || !error.retryable) {
      this.config.onFatalError(error);
      return;
    }

    if (this.recordReconnectFailureAndIsCircuitOpen()) {
      this.config.onFatalError(createReconnectCircuitOpenError(error.message));
      return;
    }

    if (
      this.config.maxReconnectAttempts > 0 &&
      this.reconnectAttempts >= this.config.maxReconnectAttempts
    ) {
      this.config.onFatalError(
        new PlugError("Plug socket reconnect attempts were exhausted.", {
          code: "SOCKET_RECONNECT_EXHAUSTED",
          description:
            "Increase Max Reconnect Attempts or restart the workflow after checking the Plug server.",
          retryable: true,
          technicalMessage: error.message,
        }),
      );
      return;
    }

    this.clearReconnectTimer();
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      this.reconnectAttempts += 1;
      this.reconnecting = false;
      this.connectWithRetry(connect).catch((connectError: unknown) => {
        const plugError =
          connectError instanceof PlugError
            ? connectError
            : new PlugError("Plug socket reconnect failed.", {
                code: "SOCKET_RECONNECT_FAILED",
                technicalMessage:
                  connectError instanceof Error ? connectError.message : undefined,
                retryable: true,
              });
        void this.handleRuntimeError(plugError, connect, async () => undefined);
      });
    }, this.getReconnectDelayMs());
  }

  async handleRuntimeError(
    error: PlugError,
    connect: () => Promise<void>,
    closeSession: () => Promise<void>,
  ): Promise<void> {
    if (this.closed || this.reconnecting) {
      return;
    }

    this.reconnecting = true;
    try {
      await closeSession();
    } finally {
      this.scheduleReconnect(error, connect);
    }
  }

  private getReconnectDelayMs(): number {
    const exponentialDelay = Math.min(
      this.reconnectMaxDelayMs,
      this.reconnectInitialDelayMs * 2 ** Math.min(this.reconnectAttempts, 8),
    );
    const jitter = 0.8 + Math.random() * 0.4;
    return Math.max(100, Math.round(exponentialDelay * jitter));
  }

  private recordReconnectFailureAndIsCircuitOpen(): boolean {
    if (this.config.maxReconnectFailuresInWindow <= 0) {
      return false;
    }

    const now = Date.now();
    const cutoff = now - this.reconnectFailureWindowMs;
    this.reconnectFailureTimes = this.reconnectFailureTimes
      .filter((timestamp) => timestamp >= cutoff)
      .concat(now);

    return this.reconnectFailureTimes.length > this.config.maxReconnectFailuresInWindow;
  }

  private delay(durationMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, durationMs);
    });
  }
}
