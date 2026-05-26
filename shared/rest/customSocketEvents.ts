import type {
  PlugHttpRequester,
  PlugSession,
  PlugCredentialDefaults,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import {
  assertCustomSocketEventName,
  assertPublishCustomSocketEventInput,
  assertPublishCustomSocketEventInputWithinLimits,
  assertPublishCustomSocketEventResponse,
  normalizeOptionalIdempotencyKey,
  type PublishCustomSocketEventInput,
  type PublishCustomSocketEventResponse,
} from "../contracts/custom-socket-events";
import { buildAuthorizedHeaders, createHttpError } from "../auth/session";
import { PlugValidationError } from "../contracts/errors";
import { buildApiUrl } from "../utils/url";

const customSocketEventPath = "/client/me/socket-events";

const normalizePublishResponseBody = (body: unknown): unknown => {
  if (typeof body !== "string" || !/^[\s]*[{[]/.test(body)) {
    return body;
  }

  try {
    return JSON.parse(body) as unknown;
  } catch (error: unknown) {
    throw new PlugValidationError(
      "Plug socket event publish response body must be valid JSON",
      { technicalMessage: error instanceof Error ? error.message : undefined },
    );
  }
};

export const publishCustomSocketEvent = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugCredentialDefaults>,
  input: PublishCustomSocketEventInput,
): Promise<PublishCustomSocketEventResponse> => {
  const request = assertPublishCustomSocketEventInput(input);
  assertPublishCustomSocketEventInputWithinLimits(request);
  const eventName = assertCustomSocketEventName(request.eventName);
  const idempotencyKey = normalizeOptionalIdempotencyKey(request.idempotencyKey);
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
      payload: request.payload,
      ...(request.payloadFrameCompression !== undefined
        ? { payloadFrameCompression: request.payloadFrameCompression }
        : {}),
    },
    timeoutMs: request.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 202) {
    throw createHttpError(response.statusCode, response.body, response.headers);
  }

  return assertPublishCustomSocketEventResponse(
    normalizePublishResponseBody(response.body),
  );
};
