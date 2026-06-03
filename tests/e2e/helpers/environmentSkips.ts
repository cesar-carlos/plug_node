const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const extractTransientHubReason = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    value.statusCode === 503 &&
    value.retryable === true &&
    typeof value.description === "string" &&
    (value.description.includes("overloaded") ||
      value.description.includes("coming online"))
  ) {
    return "Plug hub is temporarily unavailable or the agent is still coming online.";
  }

  if (
    typeof value.technicalMessage === "string" &&
    value.technicalMessage.includes("temporarily unavailable")
  ) {
    return "Plug hub is temporarily unavailable or the agent is still coming online.";
  }

  return undefined;
};

const extractAgentOfflineReason = (value: unknown): string | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.type === "string" &&
    value.type === "single" &&
    isRecord(value.item) &&
    isRecord(value.item.error)
  ) {
    const itemError = value.item.error;
    if (typeof itemError.message === "string" && itemError.message === "agent_offline") {
      return "Plug agent is offline in the target environment.";
    }

    if (isRecord(itemError.data)) {
      const reason = itemError.data.reason;
      if (
        typeof reason === "string" &&
        (reason === "agent_disconnected_at_dispatch" || reason === "agent_offline")
      ) {
        return "Plug agent is offline in the target environment.";
      }
    }
  }

  if (typeof value.message === "string" && value.message.includes("agent_offline")) {
    return "Plug agent is offline in the target environment.";
  }

  if (
    typeof value.technicalMessage === "string" &&
    value.technicalMessage === "agent_offline"
  ) {
    return "Plug agent is offline in the target environment.";
  }

  if (isRecord(value.details) && isRecord(value.details.rpcError)) {
    const rpcError = value.details.rpcError;
    if (typeof rpcError.message === "string" && rpcError.message === "agent_offline") {
      return "Plug agent is offline in the target environment.";
    }

    if (isRecord(rpcError.data)) {
      const reason = rpcError.data.reason;
      if (
        typeof reason === "string" &&
        (reason === "agent_disconnected_at_dispatch" || reason === "agent_offline")
      ) {
        return "Plug agent is offline in the target environment.";
      }
    }
  }

  if (
    typeof value.code === "string" &&
    value.code === "SOCKET_APP_ERROR" &&
    typeof value.message === "string" &&
    value.message.toLowerCase().includes("offline")
  ) {
    return "Plug agent is offline in the target environment.";
  }

  return undefined;
};

const extractTimeoutOrAbortReason = (message: string): string | undefined => {
  if (
    message.includes("operation was aborted") ||
    message.includes("Timed out while waiting for relay RPC completion") ||
    message.includes("Timed out while waiting for agents:command completion") ||
    message.includes("Timed out while waiting for agents:stream_pull_response")
  ) {
    return "Query or socket operation exceeded PLUG_E2E_TIMEOUT_MS. Use TOP N smoke queries in .env or raise the timeout.";
  }

  return undefined;
};

export const getInfrastructureSkipReason = (value: unknown): string | undefined => {
  if (value instanceof Error) {
    const timeoutMatch = extractTimeoutOrAbortReason(value.message);
    if (timeoutMatch) {
      return timeoutMatch;
    }

    const transientHubMatch = extractTransientHubReason(value);
    if (transientHubMatch) {
      return transientHubMatch;
    }

    const directMatch = extractAgentOfflineReason(value);
    if (directMatch) {
      return directMatch;
    }

    try {
      const parsed = JSON.parse(value.message) as unknown;
      return (
        extractTransientHubReason(parsed) ??
        extractAgentOfflineReason(parsed) ??
        extractTimeoutOrAbortReason(value.message)
      );
    } catch {
      if (value.message.includes("agent_offline")) {
        return "Plug agent is offline in the target environment.";
      }

      return extractTimeoutOrAbortReason(value.message);
    }
  }

  return extractTransientHubReason(value) ?? extractAgentOfflineReason(value);
};
