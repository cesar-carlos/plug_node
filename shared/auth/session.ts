import type {
  PlugCredentials,
  PlugHttpRequester,
  PlugLoginResponse,
  PlugSession,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { buildApiUrl } from "../utils/url";

const loginPath = "/client-auth/login";
const refreshPath = "/client-auth/refresh";

export interface PlugExecutionSessionRunner {
  <T>(callback: (session: PlugSession) => Promise<T>): Promise<T>;
}

const toHeaderRecord = (
  headers: Record<string, string | string[] | undefined>,
): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value === "string") {
      normalized[key.toLowerCase()] = value;
      continue;
    }

    if (Array.isArray(value) && value.length > 0) {
      normalized[key.toLowerCase()] = value.join(", ");
    }
  }
  return normalized;
};

const parseRetryAfterSeconds = (value: string | undefined): number | undefined => {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
};

const extractApiError = (
  body: unknown,
): {
  readonly message: string;
  readonly code: string;
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;
} => {
  if (!isRecord(body)) {
    return {
      message: "Plug API returned an unexpected error response.",
      code: "PLUG_API_ERROR",
    };
  }

  return {
    message:
      typeof body.message === "string" && body.message.trim() !== ""
        ? body.message
        : "Plug API returned an error response.",
    code:
      typeof body.code === "string" && body.code.trim() !== ""
        ? body.code
        : "PLUG_API_ERROR",
    correlationId:
      typeof body.requestId === "string" && body.requestId.trim() !== ""
        ? body.requestId
        : undefined,
    details: isRecord(body.details) ? body.details : undefined,
  };
};

const assertLoginResponse = (body: unknown): PlugLoginResponse => {
  if (!isRecord(body)) {
    throw new PlugValidationError("Plug login returned a non-object response");
  }

  if (typeof body.accessToken !== "string" || body.accessToken.trim() === "") {
    throw new PlugValidationError("Plug login response is missing accessToken");
  }

  if (typeof body.refreshToken !== "string" || body.refreshToken.trim() === "") {
    throw new PlugValidationError("Plug login response is missing refreshToken");
  }

  if (!isRecord(body.client)) {
    throw new PlugValidationError("Plug login response is missing client data");
  }

  return body as unknown as PlugLoginResponse;
};

export const loginClient = async (
  requester: PlugHttpRequester,
  credentials: PlugCredentials,
): Promise<PlugSession> => {
  plugLogger.debug("auth.login.start", {
    agentId: credentials.agentId,
    baseUrl: credentials.baseUrl,
  });

  const response = await requester<unknown>({
    method: "POST",
    url: buildApiUrl(credentials.baseUrl, loginPath),
    headers: {
      "content-type": "application/json",
    },
    body: {
      email: credentials.user,
      password: credentials.password,
    },
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 200) {
    const apiError = extractApiError(response.body);
    throw new PlugError(apiError.message, {
      code: apiError.code,
      statusCode: response.statusCode,
      correlationId: apiError.correlationId,
      details: apiError.details,
      authRelated: response.statusCode === 401 || response.statusCode === 403,
    });
  }

  const loginResponse = assertLoginResponse(response.body);
  plugLogger.debug("auth.login.success", {
    agentId: credentials.agentId,
    statusCode: response.statusCode,
  });

  return {
    credentials,
    accessToken: loginResponse.accessToken,
    refreshToken: loginResponse.refreshToken,
    loginResponse,
  };
};

export const refreshClientSession = async (
  requester: PlugHttpRequester,
  session: PlugSession,
): Promise<PlugSession> => {
  plugLogger.debug("auth.refresh.start", {
    agentId: session.credentials.agentId,
  });

  const response = await requester<unknown>({
    method: "POST",
    url: buildApiUrl(session.credentials.baseUrl, refreshPath),
    headers: {
      "content-type": "application/json",
    },
    body: {
      refreshToken: session.refreshToken,
    },
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 200) {
    const apiError = extractApiError(response.body);
    throw new PlugError(apiError.message, {
      code: apiError.code,
      statusCode: response.statusCode,
      correlationId: apiError.correlationId,
      details: apiError.details,
      authRelated: true,
    });
  }

  const refreshed = assertLoginResponse(response.body);
  plugLogger.debug("auth.refresh.success", {
    agentId: session.credentials.agentId,
    statusCode: response.statusCode,
  });
  return {
    credentials: session.credentials,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    loginResponse: refreshed,
  };
};

export const buildAuthorizedHeaders = (
  session: PlugSession,
  headers?: Record<string, string>,
): Record<string, string> => ({
  ...(headers ?? {}),
  authorization: `Bearer ${session.accessToken}`,
});

export const isAuthRelatedError = (error: unknown): error is PlugError =>
  error instanceof PlugError && error.authRelated;

export const createHttpError = (
  statusCode: number,
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
): PlugError => {
  const apiError = extractApiError(body);
  const normalizedHeaders = toHeaderRecord(headers);

  return new PlugError(apiError.message, {
    code: apiError.code,
    statusCode,
    correlationId: apiError.correlationId,
    retryable: statusCode === 429 || statusCode >= 500,
    retryAfterSeconds: parseRetryAfterSeconds(normalizedHeaders["retry-after"]),
    details: apiError.details,
    authRelated: statusCode === 401 || statusCode === 403,
  });
};

export const withAutoRefreshSession = async <T>(
  requester: PlugHttpRequester,
  credentials: PlugCredentials,
  callback: (session: PlugSession) => Promise<T>,
): Promise<T> => {
  const runWithSession = createExecutionSessionRunner(requester, credentials);
  return runWithSession(callback);
};

export const createExecutionSessionRunner = (
  requester: PlugHttpRequester,
  credentials: PlugCredentials,
): PlugExecutionSessionRunner => {
  let currentSession: PlugSession | undefined;
  let inFlightLogin: Promise<PlugSession> | undefined;

  const ensureSession = async (): Promise<PlugSession> => {
    if (currentSession) {
      return currentSession;
    }

    if (!inFlightLogin) {
      inFlightLogin = loginClient(requester, credentials);
    }

    try {
      currentSession = await inFlightLogin;
      return currentSession;
    } finally {
      inFlightLogin = undefined;
    }
  };

  return async <T>(callback: (session: PlugSession) => Promise<T>): Promise<T> => {
    const firstSession = await ensureSession();

    try {
      return await callback(firstSession);
    } catch (error: unknown) {
      if (!isAuthRelatedError(error)) {
        throw error;
      }

      plugLogger.warn("auth.retry_after_expiry", {
        agentId: credentials.agentId,
        code: error.code,
        statusCode: error.statusCode,
        correlationId: error.correlationId,
      });

      const refreshedSession = await refreshClientSession(requester, firstSession);
      currentSession = refreshedSession;
      return callback(refreshedSession);
    }
  };
};
