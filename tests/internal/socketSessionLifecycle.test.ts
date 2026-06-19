import { describe, expect, it, vi } from "vitest";

import {
  attachIdleCommandTimer,
  createSettleOnce,
  resolveSocketCommandTimeouts,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/socketSessionLifecycle";

describe("socketSessionLifecycle", () => {
  it("resolves connect timeout separately from command timeout", () => {
    expect(resolveSocketCommandTimeouts({ timeoutMs: 20_000 })).toEqual({
      connectTimeoutMs: 10_000,
      commandTimeoutMs: 20_000,
    });
  });

  it("settleOnce ignores late settle calls", () => {
    const settle = createSettleOnce();
    let resolved = 0;
    settle.settleOnce(() => {
      resolved += 1;
    }, undefined);
    settle.settleOnce(() => {
      resolved += 1;
    }, undefined);
    expect(resolved).toBe(1);
    expect(settle.isSettled()).toBe(true);
  });

  it("idle command timer resets on activity", async () => {
    vi.useFakeTimers();
    const settle = createSettleOnce();
    const timeouts = resolveSocketCommandTimeouts({ timeoutMs: 1000 });
    let timedOut = false;

    const idleTimer = attachIdleCommandTimer(settle, timeouts, () => {
      timedOut = true;
    });

    await vi.advanceTimersByTimeAsync(800);
    idleTimer.resetIdleTimer();
    await vi.advanceTimersByTimeAsync(800);
    expect(timedOut).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(timedOut).toBe(true);
    idleTimer.dispose();
    vi.useRealTimers();
  });
});
