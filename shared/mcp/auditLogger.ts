import type { AuditContext, AuditEntry } from "./contracts";

const sensitiveKeys = new Set([
  "clienttoken",
  "client_token",
  "password",
  "token",
  "authorization",
  "agentid",
  "agent_id",
  "refreshtoken",
  "refresh_token",
  "accesstoken",
  "access_token",
  "secret",
  "apikey",
  "api_key",
]);

const isSensitiveKey = (key: string): boolean =>
  sensitiveKeys.has(key.trim().toLowerCase());

const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (depth > 4) {
    return "[redacted]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        isSensitiveKey(key) ? "[redacted]" : sanitizeValue(entry, depth + 1),
      ]),
    );
  }

  return value;
};

const sanitizeParams = (
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    sanitized[key] = isSensitiveKey(key) ? "[redacted]" : sanitizeValue(value);
  }
  return sanitized;
};

export const buildAuditEntry = (input: {
  readonly capability: string;
  readonly params: Readonly<Record<string, unknown>>;
  readonly context: AuditContext;
  readonly startedAt: number;
  readonly finishedAt: number;
  readonly rowCount?: number;
  readonly emptyResult?: boolean;
  readonly truncated?: boolean;
  readonly isError?: boolean;
  readonly errorMessage?: string;
}): AuditEntry => ({
  capability: input.capability,
  params: sanitizeParams(input.params),
  userId: input.context.userId,
  sessionId: input.context.sessionId,
  timestamp: new Date(input.startedAt).toISOString(),
  durationMs: Math.max(0, input.finishedAt - input.startedAt),
  ...(input.rowCount !== undefined ? { rowCount: input.rowCount } : {}),
  ...(input.emptyResult !== undefined ? { emptyResult: input.emptyResult } : {}),
  ...(input.truncated !== undefined ? { truncated: input.truncated } : {}),
  ...(input.isError === true ? { isError: true } : {}),
  ...(input.errorMessage !== undefined ? { errorMessage: input.errorMessage } : {}),
});
