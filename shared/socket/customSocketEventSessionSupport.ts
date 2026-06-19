import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import {
  defaultConsumerIdleKeepaliveIntervalMs,
  defaultManualListenTimeoutMs,
  defaultSocketEventDeduplicationMaxEntries,
  defaultSocketEventListenTimeoutMaxMs,
  maxConsumerIdleKeepaliveIntervalMs,
  minConsumerIdleKeepaliveIntervalMs,
} from "../contracts/custom-socket-events";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import type { CustomSocketEventTransport } from "./customSocketEventSessionTypes";

export const normalizeNonNegativeInteger = (value: unknown): number | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric < 0) {
    return undefined;
  }

  return Math.floor(numeric);
};

export const createEventIdDedupe = (
  ttlMs: number | undefined,
  maxEntries: number,
): ((eventId: string, nowMs: number) => boolean) => {
  if (ttlMs === undefined || ttlMs <= 0) {
    return () => false;
  }

  const seen = new Map<string, number>();

  return (eventId: string, nowMs: number): boolean => {
    const existingExpiresAt = seen.get(eventId);
    if (existingExpiresAt !== undefined && existingExpiresAt > nowMs) {
      return true;
    }

    seen.set(eventId, nowMs + ttlMs);
    for (const [cachedEventId, expiresAt] of seen) {
      if (expiresAt <= nowMs || seen.size > maxEntries) {
        seen.delete(cachedEventId);
      }
      if (seen.size <= maxEntries) {
        break;
      }
    }

    return false;
  };
};

export const withSigningPolicy = (
  signing: PayloadFrameSigningOptions | undefined,
  requirePayloadSignature: boolean | undefined,
): PayloadFrameSigningOptions | undefined => {
  if (!signing && !requirePayloadSignature) {
    return undefined;
  }

  return {
    ...(signing ?? {}),
    ...(requirePayloadSignature ? { requireSignature: true } : {}),
  };
};

export const assertRequiredPayloadSigningKey = (
  signing: PayloadFrameSigningOptions | undefined,
  requirePayloadSignature: boolean | undefined,
): void => {
  if (requirePayloadSignature && (!signing?.key || signing.key.trim() === "")) {
    throw new PlugValidationError(
      "Payload Signing Key is required when Require Payload Signature is enabled.",
    );
  }
};

export const scheduleSocketEventTask = (
  scheduler: ((task: () => Promise<void>) => void) | undefined,
  task: () => Promise<void>,
  onError: (error: unknown) => void,
): void => {
  if (scheduler) {
    scheduler(task);
    return;
  }

  void task().catch(onError);
};

export const normalizeListenTimeoutMs = (value: number | undefined): number => {
  const numeric = value ?? defaultManualListenTimeoutMs;
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new PlugValidationError("Listen Timeout (MS) must be a positive number");
  }

  const normalized = Math.floor(numeric);
  if (normalized > defaultSocketEventListenTimeoutMaxMs) {
    throw new PlugValidationError(
      `Listen Timeout (MS) must be at most ${defaultSocketEventListenTimeoutMaxMs}`,
    );
  }

  return normalized;
};

export const normalizeConsumerIdleKeepaliveIntervalMs = (
  value: number | undefined,
): number => {
  if (value === undefined || value === null) {
    return defaultConsumerIdleKeepaliveIntervalMs;
  }

  if (!Number.isFinite(value) || value < 0) {
    return defaultConsumerIdleKeepaliveIntervalMs;
  }

  const normalized = Math.floor(value);
  if (normalized === 0) {
    return 0;
  }

  return Math.min(
    maxConsumerIdleKeepaliveIntervalMs,
    Math.max(minConsumerIdleKeepaliveIntervalMs, normalized),
  );
};

export const createConsumerIdleKeepalive = (input: {
  readonly transport: CustomSocketEventTransport;
  readonly intervalMs: number;
  readonly isActive: () => boolean;
  readonly touch: () => void;
}): { readonly stop: () => void } => {
  if (input.intervalMs <= 0) {
    return { stop: () => undefined };
  }

  let timer: NodeJS.Timeout | undefined = setInterval(() => {
    if (!input.transport.connected || !input.isActive()) {
      return;
    }

    try {
      input.touch();
    } catch (error: unknown) {
      plugLogger.warn("transport.socket.custom_event.keepalive_failed", {
        code: error instanceof PlugError ? error.code : undefined,
      });
    }
  }, input.intervalMs);

  return {
    stop: () => {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
  };
};

export const defaultCustomSocketEventDeduplicationMaxEntries =
  defaultSocketEventDeduplicationMaxEntries;
