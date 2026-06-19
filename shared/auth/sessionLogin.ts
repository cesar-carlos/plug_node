import type {
  PlugAnyLoginResponse,
  PlugClientAuthCredentials,
  PlugEmailPasswordCredentials,
  PlugHttpRequester,
  PlugLoginResponse,
  PlugRefreshResponse,
  PlugSession,
  PlugUserAuthCredentials,
  PlugUserLoginResponse,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import { isRecord } from "../utils/json";
import { buildApiUrl } from "../utils/url";
import { createApiHttpError } from "./sessionHttpErrors";

export interface PlugAuthEndpointConfig {
  readonly loginPath: string;
  readonly refreshPath: string;
  readonly profileKey: "client" | "user";
  readonly profileLabel: string;
}

export const clientAuthConfig: PlugAuthEndpointConfig = {
  loginPath: "/client-auth/login",
  refreshPath: "/client-auth/refresh",
  profileKey: "client",
  profileLabel: "client",
};

export const userAuthConfig: PlugAuthEndpointConfig = {
  loginPath: "/auth/login",
  refreshPath: "/auth/refresh",
  profileKey: "user",
  profileLabel: "user",
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

  const profile = (body as Record<string, unknown>)[authConfig.profileKey];
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

  const previousProfile = getLoginResponseProfile(
    previousLoginResponse,
    authConfig.profileKey,
  );
  const bodyRecord = body as Record<string, unknown>;
  const nextProfile = isRecord(bodyRecord[authConfig.profileKey])
    ? bodyRecord[authConfig.profileKey]
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

export const loginWithAuthConfig = loginWithEmailPassword;
export const refreshSessionWithAuthConfig = refreshExecutionSession;
