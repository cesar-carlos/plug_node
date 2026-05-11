import type {
  PlugHttpRequester,
  PlugSession,
  PlugCredentialDefaults,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import {
  assertCustomSocketEventName,
  assertPublishCustomSocketEventResponse,
  normalizeOptionalIdempotencyKey,
  type PublishCustomSocketEventInput,
  type PublishCustomSocketEventResponse,
} from "../contracts/custom-socket-events";
import { buildAuthorizedHeaders, createHttpError } from "../auth/session";
import { buildApiUrl } from "../utils/url";

const customSocketEventPath = "/client/me/socket-events";

export const publishCustomSocketEvent = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugCredentialDefaults>,
  input: PublishCustomSocketEventInput,
): Promise<PublishCustomSocketEventResponse> => {
  const eventName = assertCustomSocketEventName(input.eventName);
  const idempotencyKey = normalizeOptionalIdempotencyKey(input.idempotencyKey);
  const headers = buildAuthorizedHeaders(session, {
    "content-type": "application/json",
    ...(idempotencyKey !== undefined ? { "idempotency-key": idempotencyKey } : {}),
  });

  const response = await requester<unknown>({
    method: "POST",
    url: buildApiUrl(session.credentials.baseUrl, customSocketEventPath),
    headers,
    body: {
      eventName,
      payload: input.payload,
      ...(input.payloadFrameCompression !== undefined
        ? { payloadFrameCompression: input.payloadFrameCompression }
        : {}),
    },
    timeoutMs: input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 202) {
    throw createHttpError(response.statusCode, response.body, response.headers);
  }

  return assertPublishCustomSocketEventResponse(response.body);
};
