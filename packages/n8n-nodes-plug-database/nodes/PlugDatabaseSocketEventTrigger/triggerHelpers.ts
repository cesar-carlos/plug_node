import type { ITriggerFunctions } from "n8n-workflow";

import { PlugError } from "../../generated/shared/contracts/errors";
import { assertCustomSocketEventNames } from "../../generated/shared/contracts/custom-socket-events";

export const defaultReconnectInitialDelayMs = 1000;
export const defaultReconnectMaxDelayMs = 30_000;
export const defaultReconnectFailureWindowMs = 300_000;

export type PayloadSignatureRequirement = "all" | "customEvents" | "agentProfileUpdated";

export const readTriggerEventNames = (context: ITriggerFunctions): string[] => {
  const collection = context.getNodeParameter("eventNames", {}) as {
    readonly values?: ReadonlyArray<{ readonly eventName?: unknown }>;
  };

  return assertCustomSocketEventNames(
    (collection.values ?? []).map((row) => row.eventName),
  );
};

export const normalizeTriggerInteger = (
  value: unknown,
  fallback: number,
  min: number,
): number => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.floor(numeric));
};

export const createReconnectCircuitOpenError = (technicalMessage: string): PlugError =>
  new PlugError("Plug socket reconnect circuit breaker opened.", {
    code: "SOCKET_RECONNECT_CIRCUIT_OPEN",
    description:
      "Too many retryable socket failures happened inside the configured reconnect failure window.",
    retryable: true,
    technicalMessage,
  });
