import { describe, expect, it, vi } from "vitest";
import {
  ActionIoError,
  callActionIo,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import { serializeErrorForContinueOnFail } from "../../packages/n8n-nodes-plug-database/generated/shared/output/errorOutput";

describe("action deadline guidance", () => {
  it.each([
    ["validateRun", "somente Validate Run", "validação da ação"],
    ["readIo", "último checkpoint consumido", "leitura da saída"],
    ["findExecution", "Idempotency Key originais", "busca da execução"],
    ["getExecution", "mesmo Execution ID", "consulta à execução"],
    ["getInputStatus", "Message ID originais", "recebimento da entrada"],
  ])("guides %s without suggesting a new process", (operation, nextStep, title) => {
    const error = new ActionIoError("ACTION_IO_REQUEST_EXPIRED", false, {}, operation);
    expect(error.message).toContain(title);
    expect(error.description).toContain(nextStep);
    expect(error.description).toContain("online");
    expect(error.description).toContain("canal selecionado");
    expect(error.description).toContain("suporte nas duas pontas");
    expect(error.description).toContain("nem indica token expirado");
    expect(error.retryable).toBe(false);
    expect(error.details?.effects_possible).toBe(false);
    if (operation === "validateRun") {
      expect(error.description).not.toMatch(/reconcil|Find Execution|Message ID/);
      expect(error.description).toContain("não inicia o processo");
    }
  });

  it.each([
    ["run", "Find Execution"],
    ["sendInput", "Get Input Status"],
    ["closeInput", "Get Input Status"],
    ["cancel", "Get Execution"],
  ])("preserves uncertainty and safe recovery for %s", (operation, nextStep) => {
    const error = new ActionIoError(
      "RPC_-32000",
      true,
      { failure_code: "ACTION_IO_REQUEST_EXPIRED", client_token: "secret-value" },
      operation,
    );
    const visible = serializeErrorForContinueOnFail(error);
    expect(visible.code).toBe("RPC_-32000");
    expect(visible.description).toContain(nextStep);
    expect(visible.description).toContain("não confirma se o processo iniciou");
    expect(visible.retryable).toBe(false);
    expect(error.details).toMatchObject({
      outcome_unknown: true,
      effects_possible: true,
    });
    expect(JSON.stringify(visible)).not.toContain("secret-value");
  });

  it("retains the catalog operation when the response is malformed", async () => {
    const transport = vi.fn(async () => ({ jsonrpc: "2.0", id: "wrong-id", result: {} }));
    const error = await callActionIo(
      transport,
      "listAvailable",
      {},
      "private-token",
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ActionIoError);
    expect(error.code).toBe("INVALID_RESPONSE");
    expect(error.description).toContain("somente List Available Actions");
    expect(error.description).not.toMatch(/reconcil|Find Execution|relógio/);
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not classify other failures as clock or deadline problems", () => {
    const error = new ActionIoError("ACTION_IO_UNAUTHORIZED", false, {}, "validateRun");
    expect(error.description).not.toMatch(/sincronização|prazo|relógio/);
    expect(error.code).toBe("ACTION_IO_UNAUTHORIZED");
  });
});
