import { PlugError } from "../contracts/errors";
import { isRecord } from "../utils/json";

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
    const rateLimitBase =
      normalizedMessage !== ""
        ? `The request exceeded the current rate limit. ${normalizedMessage}`
        : "The request exceeded the current rate limit.";

    return {
      message: "Plug rate limited this request.",
      description: formatRetryAfterDescription(input.retryAfterSeconds, rateLimitBase),
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

export const createApiHttpError = (
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

export const createHttpError = (
  statusCode: number,
  body: unknown,
  headers: Record<string, string | string[] | undefined>,
): PlugError => createApiHttpError(statusCode, body, headers, "api");
