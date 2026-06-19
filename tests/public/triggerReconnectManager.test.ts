import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import { TriggerReconnectManager } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseSocketEventTrigger/triggerReconnectManager";

const retryableSocketError = new PlugError("Socket disconnected.", {
  code: "SOCKET_DISCONNECTED",
  retryable: true,
});

const createManager = (
  overrides: Partial<ConstructorParameters<typeof TriggerReconnectManager>[0]> = {},
): {
  readonly manager: TriggerReconnectManager;
  readonly onFatalError: ReturnType<typeof vi.fn>;
} => {
  const onFatalError = vi.fn();
  const manager = new TriggerReconnectManager({
    reconnectOnDisconnect: true,
    maxReconnectAttempts: 3,
    maxReconnectFailuresInWindow: 2,
    reconnectInitialDelayMs: 100,
    reconnectMaxDelayMs: 200,
    reconnectFailureWindowMs: 60_000,
    onFatalError,
    ...overrides,
  });

  return { manager, onFatalError };
};

describe("TriggerReconnectManager", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("resets reconnect attempts after a successful connect", async () => {
    const { manager } = createManager();
    let attempts = 0;

    const connectPromise = manager.connectWithRetry(async () => {
      attempts += 1;
      if (attempts < 2) {
        throw retryableSocketError;
      }
    });

    await vi.advanceTimersByTimeAsync(500);
    await connectPromise;

    expect(attempts).toBe(2);
    expect(manager.getReconnectAttempts()).toBe(0);
  });

  it("stops retrying when max reconnect attempts are exhausted", async () => {
    const { manager } = createManager({ maxReconnectAttempts: 2 });
    const connect = vi.fn(async () => {
      throw retryableSocketError;
    });

    const connectPromise = manager.connectWithRetry(connect);
    const rejection = expect(connectPromise).rejects.toBe(retryableSocketError);
    await vi.runAllTimersAsync();
    await rejection;

    expect(connect).toHaveBeenCalledTimes(3);
  });

  it("opens the circuit breaker after repeated failures in the window", async () => {
    const { manager } = createManager({ maxReconnectFailuresInWindow: 1 });
    const connect = vi.fn(async () => {
      throw retryableSocketError;
    });

    const connectPromise = manager.connectWithRetry(connect);
    const rejection = expect(connectPromise).rejects.toMatchObject({
      code: "SOCKET_RECONNECT_CIRCUIT_OPEN",
    });
    await vi.runAllTimersAsync();
    await rejection;
  });

  it("does not reconnect after the manager is closed", async () => {
    const { manager, onFatalError } = createManager();
    manager.markClosed();

    manager.scheduleReconnect(retryableSocketError, vi.fn());

    expect(onFatalError).toHaveBeenCalledWith(retryableSocketError);
  });

  it("reports fatal errors for non-retryable disconnects", async () => {
    const { manager, onFatalError } = createManager();
    const fatalError = new PlugError("Auth failed.", {
      code: "AUTH_FAILED",
      retryable: false,
    });

    manager.scheduleReconnect(fatalError, vi.fn());

    expect(onFatalError).toHaveBeenCalledWith(fatalError);
  });

  it("closes the session before scheduling a runtime reconnect", async () => {
    const { manager } = createManager();
    const connect = vi.fn(async () => undefined);
    const closeSession = vi.fn(async () => undefined);

    await manager.handleRuntimeError(retryableSocketError, connect, closeSession);
    await vi.advanceTimersByTimeAsync(500);

    expect(closeSession).toHaveBeenCalledTimes(1);
    expect(connect).toHaveBeenCalled();
  });
});
