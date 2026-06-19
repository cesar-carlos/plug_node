import type {
  PlugAnyLoginResponse,
  PlugEmailPasswordCredentials,
  PlugHttpRequester,
  PlugLoginResponse,
  PlugSession,
  PlugUserAuthCredentials,
  PlugUserLoginResponse,
} from "../contracts/api";
import { PlugError } from "../contracts/errors";
import { plugLogger } from "../logging/plugLogger";
import {
  clientAuthConfig,
  type PlugAuthEndpointConfig,
  loginWithAuthConfig,
  refreshSessionWithAuthConfig,
  userAuthConfig,
} from "./sessionLogin";
import {
  DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_MS,
  isSessionRefreshableError,
  shouldRefreshAccessTokenProactively,
  TERMINAL_AUTH_ERROR_CODES,
} from "./sessionRefresh";

export {
  decodeAccessTokenExpMs,
  DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_MS,
  isRefreshableAuthErrorData,
  isSessionRefreshableError,
  REFRESHABLE_AUTH_ERROR_CODES,
  shouldRefreshAccessTokenProactively,
  TERMINAL_AUTH_ERROR_CODES,
} from "./sessionRefresh";

export { createHttpError } from "./sessionHttpErrors";

export {
  loginClient,
  loginUser,
  refreshClientSession,
  refreshUserSession,
} from "./sessionLogin";

export interface PlugExecutionSessionRunner<
  TCredentials extends PlugEmailPasswordCredentials = PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse = PlugLoginResponse,
> {
  <T>(
    callback: (session: PlugSession<TCredentials, TLoginResponse>) => Promise<T>,
  ): Promise<T>;
}

export const buildAuthorizedHeaders = (
  session: PlugSession<PlugEmailPasswordCredentials, PlugAnyLoginResponse>,
  headers?: Record<string, string>,
): Record<string, string> => ({
  ...(headers ?? {}),
  authorization: `Bearer ${session.accessToken}`,
});

export const isAuthRelatedError = (error: unknown): error is PlugError =>
  error instanceof PlugError &&
  error.authRelated &&
  !TERMINAL_AUTH_ERROR_CODES.has(error.code);

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
  let inFlightRefresh: Promise<PlugSession<TCredentials, TLoginResponse>> | undefined;

  const ensureSession = async (): Promise<PlugSession<TCredentials, TLoginResponse>> => {
    if (currentSession) {
      return currentSession;
    }

    if (!inFlightLogin) {
      inFlightLogin = loginWithAuthConfig<TCredentials, TLoginResponse>(
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

  const refreshSession = async (
    session: PlugSession<TCredentials, TLoginResponse>,
  ): Promise<PlugSession<TCredentials, TLoginResponse>> => {
    const sourceSession = currentSession ?? session;

    if (!inFlightRefresh) {
      inFlightRefresh = refreshSessionWithAuthConfig(
        requester,
        sourceSession,
        effectiveAuthConfig,
      ).finally(() => {
        inFlightRefresh = undefined;
      });
    }

    currentSession = await inFlightRefresh;
    return currentSession;
  };

  const ensureAccessTokenFresh = async (): Promise<
    PlugSession<TCredentials, TLoginResponse>
  > => {
    const session = await ensureSession();
    if (
      shouldRefreshAccessTokenProactively(session, DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_MS)
    ) {
      return refreshSession(session);
    }

    return session;
  };

  return async <T>(
    callback: (session: PlugSession<TCredentials, TLoginResponse>) => Promise<T>,
  ): Promise<T> => {
    let reactiveRefreshUsed = false;
    let loginFallbackUsed = false;

    const runWithFreshSession = async (): Promise<T> => {
      const session = await ensureAccessTokenFresh();
      return callback(session);
    };

    try {
      return await runWithFreshSession();
    } catch (error: unknown) {
      if (!isSessionRefreshableError(error) || reactiveRefreshUsed) {
        throw error;
      }

      reactiveRefreshUsed = true;
      plugLogger.warn("auth.retry_after_expiry", {
        baseUrl: credentials.baseUrl,
        code: error.code,
        statusCode: error.statusCode,
        correlationId: error.correlationId,
      });

      let sessionAfterRefresh: PlugSession<TCredentials, TLoginResponse>;
      try {
        sessionAfterRefresh = await refreshSession(
          currentSession ?? (await ensureSession()),
        );
      } catch (refreshError: unknown) {
        if (
          !loginFallbackUsed &&
          refreshError instanceof PlugError &&
          refreshError.statusCode === 401
        ) {
          loginFallbackUsed = true;
          currentSession = undefined;
          const reloggedSession = await ensureSession();
          return callback(reloggedSession);
        }

        throw refreshError;
      }

      return await callback(sessionAfterRefresh);
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
