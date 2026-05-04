import type {
  AgentCommandRequestBody,
  BuiltCommandRequest,
  PlugClientAuthCredentials,
  PlugCommandTransportResult,
  PlugHttpRequester,
  PlugSession,
  RestBridgeCommandResponse,
  RestBridgeNotificationResponse,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { buildAuthorizedHeaders, createHttpError } from "../auth/session";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { buildApiUrl } from "../utils/url";

const commandPath = "/agents/commands";

const assertRestBridgeResponse = (
  body: unknown,
): RestBridgeCommandResponse | RestBridgeNotificationResponse => {
  if (!isRecord(body)) {
    throw new PlugValidationError("Plug command response must be an object");
  }

  if (typeof body.agentId !== "string" || body.agentId.trim() === "") {
    throw new PlugValidationError("Plug command response is missing agentId");
  }

  if (typeof body.requestId !== "string" || body.requestId.trim() === "") {
    throw new PlugValidationError("Plug command response is missing requestId");
  }

  if (body.notification === true) {
    if (typeof body.acceptedCommands !== "number") {
      throw new PlugValidationError(
        "Plug notification response is missing acceptedCommands",
      );
    }
    return body as unknown as RestBridgeNotificationResponse;
  }

  if (!("response" in body)) {
    throw new PlugValidationError("Plug command response is missing response");
  }

  return body as unknown as RestBridgeCommandResponse;
};

const isNotificationResponse = (
  value: RestBridgeCommandResponse | RestBridgeNotificationResponse,
): value is RestBridgeNotificationResponse =>
  "notification" in value && value.notification === true;

export const executeRestCommand = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  commandRequest: BuiltCommandRequest,
): Promise<PlugCommandTransportResult> => {
  plugLogger.debug("transport.rest.request", {
    agentId: commandRequest.agentId,
    method: Array.isArray(commandRequest.command)
      ? "batch"
      : commandRequest.command.method,
    operation: commandRequest.operation,
    timeoutMs: commandRequest.timeoutMs,
  });

  const body: AgentCommandRequestBody = {
    agentId: commandRequest.agentId,
    command: commandRequest.command,
    ...(commandRequest.timeoutMs !== undefined
      ? { timeoutMs: commandRequest.timeoutMs }
      : {}),
    ...(commandRequest.payloadFrameCompression !== undefined
      ? { payloadFrameCompression: commandRequest.payloadFrameCompression }
      : {}),
  };

  const response = await requester<unknown>({
    method: "POST",
    url: buildApiUrl(session.credentials.baseUrl, commandPath),
    headers: buildAuthorizedHeaders(session, {
      "content-type": "application/json",
    }),
    body,
    timeoutMs: commandRequest.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 200 && response.statusCode !== 202) {
    throw createHttpError(response.statusCode, response.body, response.headers);
  }

  const parsed = assertRestBridgeResponse(response.body);
  plugLogger.debug("transport.rest.response", {
    agentId: parsed.agentId,
    requestId: parsed.requestId,
    notification: isNotificationResponse(parsed),
    statusCode: response.statusCode,
  });
  if (isNotificationResponse(parsed)) {
    return {
      channel: "rest",
      agentId: parsed.agentId,
      requestId: parsed.requestId,
      notification: true,
      acceptedCommands: parsed.acceptedCommands,
      raw: parsed,
    };
  }

  const commandResponse = parsed as RestBridgeCommandResponse;
  return {
    channel: "rest",
    agentId: commandResponse.agentId,
    requestId: commandResponse.requestId,
    notification: false,
    response: commandResponse.response,
    raw: commandResponse,
  };
};
