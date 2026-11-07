import { describe, expect, it, vi } from "vitest";
import {
  ActionIoError,
  callActionIo,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";

describe("catalog expiration diagnostics", () => {
  it.each(["transport", "rpc-code", "rpc-failure-code"])(
    "explains expiration without execution reconciliation: %s",
    async (path) => {
      const transport = vi.fn(async (command) => {
        if (path === "transport")
          throw new ActionIoError("ACTION_IO_REQUEST_EXPIRED", false);
        return {
          jsonrpc: "2.0",
          id: command.id,
          error: {
            code: -32000,
            message: "Expired",
            data: {
              [path === "rpc-code" ? "code" : "failure_code"]:
                "ACTION_IO_REQUEST_EXPIRED",
              effects_possible: false,
              retryable: false,
            },
          },
        };
      });
      const error = await callActionIo(
        transport,
        "listAvailable",
        { page_size: 20 },
        "private-token",
      ).catch((e) => e);
      expect(error).toBeInstanceOf(ActionIoError);
      expect(error.code).toBe("ACTION_IO_REQUEST_EXPIRED");
      expect(error.message).toContain("prazo da consulta ao catálogo");
      expect(error.description).toContain("sincronização dos relógios");
      expect(error.description).toContain("não confirma essa causa");
      expect(error.description).toContain("somente List Available Actions");
      expect(error.description).not.toMatch(
        /reconcil|Find Execution|Idempotency Key|Message ID/i,
      );
      expect(error.description).not.toContain("private-token");
      expect(error.retryable).toBe(false);
      expect(error.details).toMatchObject({
        outcome_unknown: false,
        effects_possible: false,
      });
      expect(transport).toHaveBeenCalledOnce();
    },
  );
  it("does not diagnose every catalog error as expiration or clock skew", () => {
    const error = new ActionIoError("TRANSPORT_UNCONFIRMED", false, {}, "listAvailable");
    expect(error.description).toContain("consulta ao catálogo não inicia");
    expect(error.description).not.toMatch(/reconcil|relógio|expir/i);
    const denied = new ActionIoError(
      "ACTION_IO_UNAUTHORIZED",
      false,
      {},
      "listAvailable",
    );
    expect(denied.description).toContain("agent_actions.list");
    expect(denied.description).not.toContain("relógio");
  });
  it.each([
    ["run", "Find Execution"],
    ["sendInput", "Get Input Status"],
    ["cancel", "Get Execution"],
  ])("preserves mutation recovery for %s", (operation, hint) => {
    const error = new ActionIoError("ACTION_IO_REQUEST_EXPIRED", true, {}, operation);
    expect(error.description).toContain(hint);
    expect(error.details).toMatchObject({
      outcome_unknown: true,
      effects_possible: true,
    });
    expect(error.retryable).toBe(false);
  });
});
