import { PlugError } from "../contracts/errors";
import { isRecord } from "../utils/json";

const GENERIC_UNEXPECTED_MESSAGE =
  "An unexpected error occurred while executing the capability.";

const HTTP_STATUS_MESSAGES: Readonly<Record<number, string>> = {
  401: "Authentication failed for this capability. Check credentials or session and try again.",
  403: "Access is not authorized for this capability.",
  429: "Too many requests in sequence. Please wait a moment.",
};

const PLUG_CODE_MESSAGES: Readonly<Record<string, string>> = {
  PLUG_VALIDATION_ERROR: "The provided parameters are not valid for this capability.",
  PLUG_TIMEOUT: "The query took longer than expected. Please try again.",
};

const readAgentOfflineReason = (error: PlugError): string | undefined => {
  const reason = error.details?.reason;
  if (reason === "agent_offline" || reason === "agent_disconnected_at_dispatch") {
    return "The ERP system is temporarily unavailable. Please try again shortly.";
  }
  if (reason === "denied_resources") {
    return "This capability is not authorized for the current access profile.";
  }
  if (reason === "rate_limited") {
    return HTTP_STATUS_MESSAGES[429];
  }
  return undefined;
};

export const mapPlugErrorToFriendlyMessage = (error: unknown): string => {
  if (error instanceof PlugError) {
    const agentMessage = readAgentOfflineReason(error);
    if (agentMessage) {
      return agentMessage;
    }

    if (error.statusCode !== undefined && error.statusCode in HTTP_STATUS_MESSAGES) {
      return HTTP_STATUS_MESSAGES[error.statusCode];
    }

    if (error.code in PLUG_CODE_MESSAGES) {
      return PLUG_CODE_MESSAGES[error.code];
    }

    return GENERIC_UNEXPECTED_MESSAGE;
  }

  if (error instanceof Error) {
    const message = error.message.trim();
    if (
      message.startsWith("Capability ") ||
      message.startsWith("At least one business filter") ||
      message.startsWith("Result limit cannot exceed") ||
      message.startsWith("Unknown parameter") ||
      message.startsWith("Parameter ") ||
      message.includes("tool calls per turn")
    ) {
      return message;
    }

    return GENERIC_UNEXPECTED_MESSAGE;
  }

  if (isRecord(error) && typeof error.message === "string") {
    return GENERIC_UNEXPECTED_MESSAGE;
  }

  return GENERIC_UNEXPECTED_MESSAGE;
};
