import type {
  PlugAnyLoginResponse,
  PlugEmailPasswordCredentials,
  PlugClientAuthCredentials,
  PlugHttpRequester,
  PlugLoginResponse,
  PlugRefreshResponse,
  PlugSession,
  PlugUserAuthCredentials,
  PlugUserLoginResponse,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { buildApiUrl } from "../utils/url";

interface PlugAuthEndpointConfig {
  readonly loginPath: string;
  readonly refreshPath: string;
  readonly profileKey: "client" | "user";
  readonly profileLabel: string;
}

const clientAuthConfig: PlugAuthEndpointConfig = {
  loginPath: "/client-auth/login",
  refreshPath: "/client-auth/refresh",
  profileKey: "client",
  profileLabel: "client",
};

const userAuthConfig: PlugAuthEndpointConfig = {
  loginPath: "/auth/login",
  refreshPath: "/auth/refresh",
  profileKey: "user",
  profileLabel: "user",
};

export interface PlugExecutionSessionRunner<
  TCredentials extends PlugEmailPasswordCredentials = PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse = PlugLoginResponse,
> {
  <T>(
    callback: (session: PlugSession<TCredentials, TLoginResponse>) => Promise<T>,
  ): Promise<T>;
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

const parseResetAtToSeconds = (value: unknown): number | undefined => {
  if (typeof value !== "string" || value.trim() === "") {
    return undefined;
  }

  const targetTimestamp = Date.parse(value);
  if (!Number.isFinite(targetTimestamp)) {
    return undefined;
  }

  const deltaMs = targetTimestamp - Date.now();
  return deltaMs > 0 ? Math.max(1, Math.ceil(deltaMs / 1000)) : 1;
};

const extractApiError = (
  body: unknown,
): {
  readonly message: string;
  readonly code: string;
  readonly correlationId?: string;
  readonly details?: Record<string, unknown>;
  readonly issues?: Array<{
    readonly field?: string;
    readonly message: string;
  }>;
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
    issues: Array.isArray(body.issues)
      ? body.issues
          .map((issue) => {
            if (!isRecord(issue) || typeof issue.message !== "string") {
              return undefined;
            }

            return {
              ...(typeof issue.field === "string" && issue.field.trim() !== ""
                ? { field: issue.field }
                : {}),
              message: issue.message,
            };
          })
          .filter(
            (
              issue,
            ): issue is {
              readonly field?: string;
              readonly message: string;
            } => issue !== undefined,
          )
      : undefined,
  };
};

const parseRetryAfterFromDetails = (
  details: Record<string, unknown> | undefined,
): number | undefined => {
  if (!details) {
    return undefined;
  }

  if (
    typeof details.retry_after_ms === "number" &&
    Number.isFinite(details.retry_after_ms)
  ) {
    return Math.max(1, Math.ceil(details.retry_after_ms / 1000));
  }

  return parseResetAtToSeconds(details.reset_at);
};

const formatIssueSummary = (
  issues:
    | Array<{
        readonly field?: string;
        readonly message: string;
      }>
    | undefined,
): string | undefined => {
  if (!issues || issues.length === 0) {
    return undefined;
  }

  return issues
    .slice(0, 3)
    .map((issue) => (issue.field ? `${issue.field}: ${issue.message}` : issue.message))
    .join("; ");
};

const formatRetryAfterDescription = (
  retryAfterSeconds: number | undefined,
  fallback: string,
): string => {
  if (retryAfterSeconds === undefined) {
    return fallback;
  }

  return `${fallback} Wait ${retryAfterSeconds} second(s) before trying again.`;
};

const buildApiErrorPresentation = (input: {
  readonly requestKind: "login" | "refresh" | "api";
  readonly statusCode: number;
  readonly message: string;
  readonly code: string;
  readonly retryAfterSeconds?: number;
  readonly issues?: Array<{
    readonly field?: string;
    readonly message: string;
  }>;
}): {
  readonly message: string;
  readonly description?: string;
} => {
  const normalizedMessage = input.message.trim();
  const blocked =
    input.code === "ACCOUNT_BLOCKED" ||
    normalizedMessage.toLowerCase().includes("blocked");
  const issueSummary = formatIssueSummary(input.issues);

  if (input.statusCode === 400) {
    return {
      message: "Plug rejected the request parameters.",
      description:
        issueSummary ??
        "Review the node fields and any advanced JSON before trying again.",
    };
  }

  if (input.statusCode === 401) {
    if (input.requestKind === "login") {
      return {
        message: "Plug rejected the login credentials.",
        description: "Check User (email) and Password in the credential.",
      };
    }

    if (input.requestKind === "refresh") {
      return {
        message: "The Plug session expired and could not be refreshed.",
        description: "Run the node again to create a new authenticated session.",
      };
    }

    return {
      message: "Plug rejected the current session.",
      description: "Run the node again. If it keeps failing, recheck the credential.",
    };
  }

  if (input.statusCode === 403) {
    if (blocked) {
      return {
        message: "The Plug account is blocked.",
        description: "Contact the account owner or administrator to unblock the account.",
      };
    }

    return {
      message:
        normalizedMessage !== ""
          ? normalizedMessage
          : "The authenticated account is not allowed to perform this operation.",
      description:
        input.requestKind === "login"
          ? "Confirm that the account is active and allowed to log in as a client."
          : "Confirm that this client still has permission to use the selected agent.",
    };
  }

  if (input.statusCode === 404 && input.requestKind === "api") {
    return {
      message: "The selected agent was not found in the active Plug hub registry.",
      description:
        "Check the Agent ID and confirm that the agent has connected and registered on this hub.",
    };
  }

  if (input.statusCode === 429) {
    return {
      message: "Plug rate limited this request.",
      description: formatRetryAfterDescription(
        input.retryAfterSeconds,
        "The request exceeded the current rate limit.",
      ),
    };
  }

  if (input.statusCode === 503) {
    return {
      message:
        normalizedMessage !== "" ? normalizedMessage : "Plug is temporarily unavailable.",
      description: formatRetryAfterDescription(
        input.retryAfterSeconds,
        "The hub may be overloaded or the agent may still be coming online.",
      ),
    };
  }

  return {
    message:
      normalizedMessage !== "" ? normalizedMessage : "Plug returned an error response.",
    ...(issueSummary ? { description: issueSummary } : {}),
  };
};

const createApiHttpError = (
  statusCode: number,
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
  requestKind: "login" | "refresh" | "api",
): PlugError => {
  const apiError = extractApiError(body);
  const normalizedHeaders = toHeaderRecord(headers);
  const retryAfterSeconds =
    parseRetryAfterSeconds(normalizedHeaders["retry-after"]) ??
    parseRetryAfterFromDetails(apiError.details);
  const presentation = buildApiErrorPresentation({
    requestKind,
    statusCode,
    message: apiError.message,
    code: apiError.code,
    retryAfterSeconds,
    issues: apiError.issues,
  });

  const details =
    apiError.details || apiError.issues
      ? {
          ...(apiError.details ?? {}),
          ...(apiError.issues ? { issues: apiError.issues } : {}),
        }
      : undefined;

  return new PlugError(presentation.message, {
    code: apiError.code,
    statusCode,
    correlationId: apiError.correlationId,
    retryable: statusCode === 429 || statusCode >= 500,
    retryAfterSeconds,
    description: presentation.description,
    details,
    technicalMessage: apiError.message,
    authRelated: statusCode === 401 || statusCode === 403,
  });
};

const assertTokenPair = (
  body: unknown,
  requestKind: "login" | "refresh",
): {
  readonly accessToken: string;
  readonly refreshToken: string;
} => {
  if (!isRecord(body)) {
    throw new PlugValidationError(`Plug ${requestKind} returned a non-object response`);
  }

  if (typeof body.accessToken !== "string" || body.accessToken.trim() === "") {
    throw new PlugValidationError(`Plug ${requestKind} response is missing accessToken`);
  }

  if (typeof body.refreshToken !== "string" || body.refreshToken.trim() === "") {
    throw new PlugValidationError(`Plug ${requestKind} response is missing refreshToken`);
  }

  return {
    accessToken: body.accessToken,
    refreshToken: body.refreshToken,
  };
};

const assertLoginResponse = <TLoginResponse extends PlugAnyLoginResponse>(
  body: unknown,
  authConfig: PlugAuthEndpointConfig,
): TLoginResponse => {
  const tokenPair = assertTokenPair(body, "login");
  if (!isRecord(body)) {
    throw new PlugValidationError("Plug login returned a non-object response");
  }

  const profile = body[authConfig.profileKey];
  if (!isRecord(profile)) {
    throw new PlugValidationError(
      `Plug login response is missing ${authConfig.profileLabel} data`,
    );
  }

  return {
    ...(body as unknown as TLoginResponse),
    ...tokenPair,
  } as TLoginResponse;
};

const getLoginResponseProfile = (
  response: PlugAnyLoginResponse,
  profileKey: "client" | "user",
): Record<string, unknown> => {
  if (profileKey === "client") {
    if (!("client" in response) || !isRecord(response.client)) {
      throw new PlugValidationError("Plug login response is missing client data");
    }

    return response.client;
  }

  if (!("user" in response) || !isRecord(response.user)) {
    throw new PlugValidationError("Plug login response is missing user data");
  }

  return response.user;
};

const assertRefreshResponse = <TLoginResponse extends PlugAnyLoginResponse>(
  body: unknown,
  previousLoginResponse: TLoginResponse,
  authConfig: PlugAuthEndpointConfig,
): TLoginResponse => {
  const tokenPair = assertTokenPair(body, "refresh");

  if (!isRecord(body)) {
    throw new PlugValidationError("Plug refresh returned a non-object response");
  }

  const previousProfile = getLoginResponseProfile(
    previousLoginResponse,
    authConfig.profileKey,
  );
  const nextProfile = isRecord(body[authConfig.profileKey])
    ? body[authConfig.profileKey]
    : previousProfile;

  return {
    ...(body as unknown as PlugRefreshResponse),
    ...tokenPair,
    [authConfig.profileKey]: nextProfile,
  } as TLoginResponse;
};

const loginWithEmailPassword = async <
  TCredentials extends PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse,
>(
  requester: PlugHttpRequester,
  credentials: TCredentials,
  authConfig: PlugAuthEndpointConfig,
): Promise<PlugSession<TCredentials, TLoginResponse>> => {
  plugLogger.debug("auth.login.start", {
    baseUrl: credentials.baseUrl,
  });

  const response = await requester<unknown>({
    method: "POST",
    url: buildApiUrl(credentials.baseUrl, authConfig.loginPath),
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
    throw createApiHttpError(
      response.statusCode,
      response.body,
      response.headers,
      "login",
    );
  }

  const loginResponse = assertLoginResponse<TLoginResponse>(response.body, authConfig);
  plugLogger.debug("auth.login.success", {
    statusCode: response.statusCode,
  });

  return {
    credentials,
    accessToken: loginResponse.accessToken,
    refreshToken: loginResponse.refreshToken,
    loginResponse,
  } as PlugSession<TCredentials, TLoginResponse>;
};

const refreshExecutionSession = async <
  TCredentials extends PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse,
>(
  requester: PlugHttpRequester,
  session: PlugSession<TCredentials, TLoginResponse>,
  authConfig: PlugAuthEndpointConfig,
): Promise<PlugSession<TCredentials, TLoginResponse>> => {
  plugLogger.debug("auth.refresh.start", {
    baseUrl: session.credentials.baseUrl,
  });

  const response = await requester<unknown>({
    method: "POST",
    url: buildApiUrl(session.credentials.baseUrl, authConfig.refreshPath),
    headers: {
      "content-type": "application/json",
    },
    body: {
      refreshToken: session.refreshToken,
    },
    timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS,
  });

  if (response.statusCode !== 200) {
    throw createApiHttpError(
      response.statusCode,
      response.body,
      response.headers,
      "refresh",
    );
  }

  const refreshed = assertRefreshResponse<TLoginResponse>(
    response.body,
    session.loginResponse,
    authConfig,
  );
  plugLogger.debug("auth.refresh.success", {
    baseUrl: session.credentials.baseUrl,
    statusCode: response.statusCode,
  });
  return {
    credentials: session.credentials,
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    loginResponse: refreshed,
  };
};

export const loginClient = async <TCredentials extends PlugClientAuthCredentials>(
  requester: PlugHttpRequester,
  credentials: TCredentials,
): Promise<PlugSession<TCredentials, PlugLoginResponse>> =>
  loginWithEmailPassword(requester, credentials, clientAuthConfig);

export const loginUser = async <TCredentials extends PlugUserAuthCredentials>(
  requester: PlugHttpRequester,
  credentials: TCredentials,
): Promise<PlugSession<TCredentials, PlugUserLoginResponse>> =>
  loginWithEmailPassword(requester, credentials, userAuthConfig);

export const refreshClientSession = async <
  TCredentials extends PlugClientAuthCredentials,
>(
  requester: PlugHttpRequester,
  session: PlugSession<TCredentials, PlugLoginResponse>,
): Promise<PlugSession<TCredentials, PlugLoginResponse>> =>
  refreshExecutionSession(requester, session, clientAuthConfig);

export const refreshUserSession = async <TCredentials extends PlugUserAuthCredentials>(
  requester: PlugHttpRequester,
  session: PlugSession<TCredentials, PlugUserLoginResponse>,
): Promise<PlugSession<TCredentials, PlugUserLoginResponse>> =>
  refreshExecutionSession(requester, session, userAuthConfig);

export const buildAuthorizedHeaders = (
  session: PlugSession<PlugEmailPasswordCredentials, PlugAnyLoginResponse>,
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
  return createApiHttpError(statusCode, body, headers, "api");
};

export const withAutoRefreshSession = async <
  T,
  TCredentials extends PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse,
>(
  requester: PlugHttpRequester,
  credentials: TCredentials,
  callback: (session: PlugSession<TCredentials, TLoginResponse>) => Promise<T>,
  authConfig?: PlugAuthEndpointConfig,
): Promise<T> => {
  const runWithSession = createExecutionSessionRunner<TCredentials, TLoginResponse>(
    requester,
    credentials,
    authConfig,
  );
  return runWithSession(callback);
};

export const createExecutionSessionRunner = <
  TCredentials extends PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse = PlugLoginResponse,
>(
  requester: PlugHttpRequester,
  credentials: TCredentials,
  authConfig?: PlugAuthEndpointConfig,
): PlugExecutionSessionRunner<TCredentials, TLoginResponse> => {
  const effectiveAuthConfig = authConfig ?? clientAuthConfig;

  let currentSession: PlugSession<TCredentials, TLoginResponse> | undefined;
  let inFlightLogin: Promise<PlugSession<TCredentials, TLoginResponse>> | undefined;

  const ensureSession = async (): Promise<PlugSession<TCredentials, TLoginResponse>> => {
    if (currentSession) {
      return currentSession;
    }

    if (!inFlightLogin) {
      inFlightLogin = loginWithEmailPassword<TCredentials, TLoginResponse>(
        requester,
        credentials,
        effectiveAuthConfig,
      );
    }

    try {
      currentSession = await inFlightLogin;
      return currentSession;
    } finally {
      inFlightLogin = undefined;
    }
  };

  return async <T>(
    callback: (session: PlugSession<TCredentials, TLoginResponse>) => Promise<T>,
  ): Promise<T> => {
    const firstSession = await ensureSession();

    try {
      return await callback(firstSession);
    } catch (error: unknown) {
      if (!isAuthRelatedError(error)) {
        throw error;
      }

      plugLogger.warn("auth.retry_after_expiry", {
        baseUrl: credentials.baseUrl,
        code: error.code,
        statusCode: error.statusCode,
        correlationId: error.correlationId,
      });

      const refreshedSession = await refreshExecutionSession(
        requester,
        firstSession,
        effectiveAuthConfig,
      );
      currentSession = refreshedSession;
      return callback(refreshedSession);
    }
  };
};

export const createUserExecutionSessionRunner = <
  TCredentials extends PlugUserAuthCredentials,
>(
  requester: PlugHttpRequester,
  credentials: TCredentials,
): PlugExecutionSessionRunner<TCredentials, PlugUserLoginResponse> =>
  createExecutionSessionRunner(requester, credentials, userAuthConfig);
