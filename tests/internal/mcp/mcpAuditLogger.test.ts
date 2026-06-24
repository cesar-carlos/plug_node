import { describe, expect, it } from "vitest";

import { buildAuditEntry } from "../../../shared/mcp/auditLogger";

describe("mcp auditLogger", () => {
  it("should build audit entries without sensitive parameter values", () => {
    const entry = buildAuditEntry({
      capability: "consultar_cliente",
      params: {
        nomeCliente: "Joao",
        clientToken: "secret-token",
        password: "secret-password",
      },
      context: {
        userId: "user-1",
        sessionId: "session-1",
      },
      startedAt: 1_000,
      finishedAt: 1_250,
      rowCount: 3,
      emptyResult: false,
      truncated: false,
    });

    expect(entry).toMatchObject({
      capability: "consultar_cliente",
      userId: "user-1",
      sessionId: "session-1",
      durationMs: 250,
      rowCount: 3,
      params: {
        nomeCliente: "Joao",
        clientToken: "[redacted]",
        password: "[redacted]",
      },
    });
    expect(entry.timestamp).toBe(new Date(1_000).toISOString());
  });
});
