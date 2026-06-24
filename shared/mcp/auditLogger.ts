import type { AuditContext, AuditEntry } from "./contracts";

const sanitizeParams = (
  params: Readonly<Record<string, unknown>>,
): Record<string, unknown> => {
  const sensitiveKeys = new Set([
    "clientToken",
    "client_token",
    "password",
    "token",
    "authorization",
    "agentId",
    "agent_id",
  ]);

  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => [
      key,
      sensitiveKeys.has(key) ? "[redacted]" : value,
    ]),
  );
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
