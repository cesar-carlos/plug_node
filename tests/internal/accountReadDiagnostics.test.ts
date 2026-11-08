import { describe, expect, it } from "vitest";
import { ActionIoError } from "../../shared/contracts/actionIo/client";
import { callSqlExtension } from "../../shared/contracts/sqlOperation/client";
import { withAgentCredentialDiagnostics } from "../../shared/n8n/agentCredentialSource";

describe("account-only read diagnostics", () => {
  it.each(["rpc", "transport"])(
    "explains health authorization from %s without execution recovery",
    async (boundary) => {
      const details = {
        failure_code: "CONFIG_ERROR",
        reason: "unauthorized",
        effects_possible: false,
      };
      const result = withAgentCredentialDiagnostics("account", () =>
        callSqlExtension(
          async (command) => {
            if (boundary === "transport")
              throw new ActionIoError("CONFIG_ERROR", false, details);
            return {
              jsonrpc: "2.0",
              id: command.id,
              error: { code: -32002, message: "private diagnostic", data: details },
            };
          },
          "agent.getHealth",
          {},
          "private-token",
        ),
      );
      const error = (await result.catch((value: unknown) => value)) as ActionIoError;
      expect(error.code).toBe("CONFIG_ERROR");
      expect(error.description).toContain("Default Client Token");
      expect(error.description).toContain("Get Agent Health");
      expect(error.description).not.toMatch(/Execution ID|Message ID|chave da ação/);
      expect(error.details).toMatchObject({
        reason: "unauthorized",
        effects_possible: false,
        outcome_unknown: false,
      });
      expect(JSON.stringify(error)).not.toContain("private");
    },
  );
  it("explains catalog NOT_FOUND without inventing a missing action", async () => {
    const error = (await withAgentCredentialDiagnostics("account", async () => {
      throw new ActionIoError("NOT_FOUND", false, {}, "listAvailable");
    }).catch((value: unknown) => value)) as ActionIoError;
    expect(error.description).toContain("Default Agent ID");
    expect(error.description).toContain("catálogo");
    expect(error.description).not.toMatch(/Execution ID|Message ID/);
    expect(error.code).toBe("NOT_FOUND");
  });
});
