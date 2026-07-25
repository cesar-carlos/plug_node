import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import { PlugTimeoutError } from "../contracts/errors";

export const DEFAULT_SOCKET_CONNECT_TIMEOUT_MS = 10_000;
export const IDLE_COMMAND_TIMER_CHECK_INTERVAL_MS = 250;

export interface SocketCommandTimeouts {
  readonly connectTimeoutMs: number;
  readonly commandTimeoutMs: number;
}

export const resolveSocketCommandTimeouts = (input?: {
  readonly timeoutMs?: number;
  readonly connectTimeoutMs?: number;
}): SocketCommandTimeouts => {
  const commandTimeoutMs = input?.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  const connectTimeoutMs = Math.min(
    input?.connectTimeoutMs ?? DEFAULT_SOCKET_CONNECT_TIMEOUT_MS,
    commandTimeoutMs,
  );

  return { connectTimeoutMs, commandTimeoutMs };
};

export interface SettleOnceController {
  readonly isSettled: () => boolean;
  readonly settleOnce: <T>(callback: (value: T) => void, value: T) => void;
}

export const createSettleOnce = (): SettleOnceController => {
  let settled = false;

  return {
    isSettled: () => settled,
    settleOnce: (callback, value) => {
      if (settled) {
        return;
      }

      settled = true;
      callback(value);
    },
  };
};

export const attachIdleCommandTimer = (
  settle: SettleOnceController,
  timeouts: SocketCommandTimeouts,
  onTimeout: () => void,
): {
  readonly resetIdleTimer: () => void;
  readonly dispose: () => void;
} => {
  let lastActivityMs = Date.now();
  let checkTimer: NodeJS.Timeout | undefined;

  const dispose = (): void => {
    if (checkTimer) {
      clearInterval(checkTimer);
      checkTimer = undefined;
    }
  };

  const resetIdleTimer = (): void => {
    if (settle.isSettled()) {
      return;
    }

    lastActivityMs = Date.now();
  };

  checkTimer = setInterval(() => {
    if (settle.isSettled()) {
      dispose();
      return;
    }

    if (Date.now() - lastActivityMs >= timeouts.commandTimeoutMs) {
      dispose();
      onTimeout();
    }
  }, IDLE_COMMAND_TIMER_CHECK_INTERVAL_MS);

  // Ensure the interval does not keep the process alive on its own.
  if (typeof checkTimer.unref === "function") {
    checkTimer.unref();
  }

  return { resetIdleTimer, dispose };
};

export const buildSocketCommandTimeoutError = (input: {
  readonly message: string;
  readonly timeoutMs: number;
  readonly eventName: string;
  readonly details?: Record<string, unknown>;
}): PlugTimeoutError =>
  new PlugTimeoutError(input.message, {
    timeoutMs: input.timeoutMs,
    eventName: input.eventName,
    ...input.details,
  });
