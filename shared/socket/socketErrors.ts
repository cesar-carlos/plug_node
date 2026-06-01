import {
  isRefreshableAuthErrorData,
  TERMINAL_AUTH_ERROR_CODES,
} from "../auth/sessionRefresh";
import { PlugError } from "../contracts/errors";
import { isRecord } from "../utils/json";

export interface SocketErrorData {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
  readonly details?: Record<string, unknown>;
}

export interface SocketConnectErrorOptions {
  readonly refreshDescription: string;
  readonly retryDescription: string;
}

export interface SocketApplicationErrorOptions {
  readonly refreshDescription: string;
  readonly retryableCodes?: readonly string[];
  readonly namespaceDeprecatedDescription?: string;
}

const accountBlockedCode = "ACCOUNT_BLOCKED";
const agentAccessRevokedCode = "AGENT_ACCESS_REVOKED";
const namespaceDeprecatedCode = "NAMESPACE_DEPRECATED";

export const terminalSocketAuthErrorCodes = TERMINAL_AUTH_ERROR_CODES;

export const readSocketErrorData = (payload: unknown): SocketErrorData => {
  const direct = isRecord(payload) ? payload : {};
  const nested = isRecord(direct.data)
    ? direct.data
    : payload instanceof Error && isRecord((payload as Error & { data?: unknown }).data)
      ? ((payload as Error & { data?: unknown }).data as Record<string, unknown>)
      : {};
  const source = {
    ...nested,
    ...direct,
  };

  return {
    code:
      typeof source.code === "string" && source.code.trim() !== ""
        ? source.code
        : undefined,
    message:
      payload instanceof Error
        ? payload.message
        : typeof payload === "string" && payload.trim() !== ""
          ? payload
          : typeof source.message === "string" && source.message.trim() !== ""
            ? source.message
            : undefined,
    statusCode:
      typeof source.statusCode === "number" && Number.isFinite(source.statusCode)
        ? source.statusCode
        : typeof source.status === "number" && Number.isFinite(source.status)
          ? source.status
          : undefined,
    details: isRecord(source.details) ? source.details : undefined,
  };
};

export const isRefreshableSocketAuthError = (input: SocketErrorData): boolean =>
  isRefreshableAuthErrorData({
    code: input.code,
    message: input.message,
    statusCode: input.statusCode,
  });

export const isTerminalSocketAuthErrorCode = (code: string | undefined): boolean =>
  code !== undefined && terminalSocketAuthErrorCodes.has(code);

const createTerminalSocketAuthError = (input: {
  readonly code: string;
  readonly statusCode?: number;
  readonly details?: Record<string, unknown>;
  readonly message?: string;
}): PlugError => {
  if (input.code === accountBlockedCode) {
    return new PlugError("The Plug account is blocked.", {
      code: input.code,
      statusCode: input.statusCode,
      description:
        "The server closed the socket because the user or client account is blocked.",
      details: input.details,
      technicalMessage: input.message,
      authRelated: true,
    });
  }

  return new PlugError("Client access to this agent was revoked.", {
    code: input.code,
    statusCode: input.statusCode,
    description:
      "Ask the agent owner to approve access again or update the credential before retrying.",
    details: input.details,
    technicalMessage: input.message,
    authRelated: true,
  });
};

export const createSocketConnectError = (
  payload: unknown,
  options: SocketConnectErrorOptions,
): PlugError => {
  const socketError = readSocketErrorData(payload);
  const refreshableAuthError = isRefreshableSocketAuthError(socketError);
  const code = socketError.code ?? "SOCKET_CONNECT_ERROR";
  const message = socketError.message ?? "Socket connection failed";

  if (isTerminalSocketAuthErrorCode(code)) {
    return createTerminalSocketAuthError({
      code,
      statusCode: socketError.statusCode,
      details: socketError.details,
      message,
    });
  }

  return new PlugError("Failed to connect to the Plug socket.", {
    code,
    statusCode: socketError.statusCode,
    description: refreshableAuthError
      ? options.refreshDescription
      : options.retryDescription,
    details: socketError.details,
    technicalMessage: message,
    retryable: true,
    authRelated: refreshableAuthError,
  });
};

export const createSocketApplicationError = (
  payload: unknown,
  options: SocketApplicationErrorOptions,
): PlugError => {
  const appError = readSocketErrorData(payload);
  const code = appError.code !== undefined ? appError.code : "SOCKET_APP_ERROR";

  if (isTerminalSocketAuthErrorCode(code)) {
    return createTerminalSocketAuthError({
      code,
      statusCode: appError.statusCode,
      details: appError.details,
      message: appError.message,
    });
  }

  if (isRefreshableSocketAuthError(appError)) {
    return new PlugError("The Plug socket session expired.", {
      code,
      statusCode: appError.statusCode,
      description: options.refreshDescription,
      details: appError.details,
      technicalMessage: appError.message,
      retryable: true,
      authRelated: true,
    });
  }

  if (
    code === namespaceDeprecatedCode &&
    options.namespaceDeprecatedDescription !== undefined
  ) {
    return new PlugError("The Plug socket namespace is deprecated.", {
      code,
      statusCode: appError.statusCode,
      description: options.namespaceDeprecatedDescription,
      details: appError.details,
      technicalMessage: appError.message,
    });
  }

  return new PlugError(
    appError.message !== undefined
      ? appError.message
      : "Plug socket reported an application error.",
    {
      code,
      statusCode: appError.statusCode,
      details: appError.details,
      retryable: options.retryableCodes?.includes(code) ?? false,
    },
  );
};
