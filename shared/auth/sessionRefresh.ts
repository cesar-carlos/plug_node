import type {
  PlugAnyLoginResponse,
  PlugEmailPasswordCredentials,
  PlugSession,
} from "../contracts/api";
import { PlugError } from "../contracts/errors";

export const TERMINAL_AUTH_ERROR_CODES = new Set([
  "ACCOUNT_BLOCKED",
  "AGENT_ACCESS_REVOKED",
]);

export const REFRESHABLE_AUTH_ERROR_CODES = new Set([
  "TOKEN_EXPIRED",
  "ACCESS_TOKEN_EXPIRED",
  "SESSION_EXPIRED",
  "INVALID_TOKEN",
  "UNAUTHORIZED",
  "AUTHENTICATION_FAILED",
]);

export const DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_MS = 60_000;

const refreshableAuthMessageFragments = [
  "token expired",
  "jwt expired",
  "invalid token",
  "unauthorized",
] as const;

const decodeBase64UrlJson = (segment: string): unknown => {
  const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padding =
    normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  const decoded = Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
  return JSON.parse(decoded) as unknown;
};

export const decodeAccessTokenExpMs = (accessToken: string): number | undefined => {
  const trimmed = accessToken.trim();
  if (trimmed === "") {
    return undefined;
  }

  const segments = trimmed.split(".");
  if (segments.length < 2) {
    return undefined;
  }

  try {
    const payload = decodeBase64UrlJson(segments[1]);
    if (
      typeof payload !== "object" ||
      payload === null ||
      !("exp" in payload) ||
      typeof (payload as { exp?: unknown }).exp !== "number" ||
      !Number.isFinite((payload as { exp: number }).exp)
    ) {
      return undefined;
    }

    return (payload as { exp: number }).exp * 1000;
  } catch {
    return undefined;
  }
};

export const shouldRefreshAccessTokenProactively = (
  session: PlugSession<PlugEmailPasswordCredentials, PlugAnyLoginResponse>,
  bufferMs: number = DEFAULT_ACCESS_TOKEN_REFRESH_BUFFER_MS,
  nowMs: number = Date.now(),
): boolean => {
  const expMs = decodeAccessTokenExpMs(session.accessToken);
  if (expMs === undefined) {
    return false;
  }

  return expMs - nowMs <= bufferMs;
};

const hasRefreshableAuthMessage = (message: string | undefined): boolean => {
  if (message === undefined || message.trim() === "") {
    return false;
  }

  const normalized = message.toLowerCase();
  return refreshableAuthMessageFragments.some((fragment) =>
    normalized.includes(fragment),
  );
};

export const isRefreshableAuthErrorData = (input: {
  readonly code?: string;
  readonly message?: string;
  readonly statusCode?: number;
}): boolean => {
  const code = input.code?.toUpperCase() ?? "";
  if (TERMINAL_AUTH_ERROR_CODES.has(code)) {
    return false;
  }

  if (input.statusCode === 401) {
    return true;
  }

  if (input.statusCode === 403) {
    return (
      REFRESHABLE_AUTH_ERROR_CODES.has(code) || hasRefreshableAuthMessage(input.message)
    );
  }

  return false;
};

export const isSessionRefreshableError = (error: unknown): error is PlugError => {
  if (!(error instanceof PlugError)) {
    return false;
  }

  return isRefreshableAuthErrorData({
    code: error.code,
    message: error.technicalMessage ?? error.message,
    statusCode: error.statusCode,
  });
};
