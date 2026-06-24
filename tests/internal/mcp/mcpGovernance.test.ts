import { describe, expect, it } from "vitest";

import type { CapabilityDefinition } from "../../../shared/mcp/contracts";
import { enforceGovernance, maskSensitiveColumns } from "../../../shared/mcp/governance";

const capability = (): CapabilityDefinition => ({
  name: "consultar_cliente",
  displayName: "Consultar Cliente",
  description: "Busca clientes.",
  whenToUse: "Use para identificar clientes.",
  whenNotToUse: "Nao use para financeiro.",
  category: "crm",
  parameters: {
    codCliente: { type: "number", description: "Codigo do cliente." },
    nomeCliente: { type: "string", description: "Nome parcial do cliente." },
    limite: { type: "number", description: "Limite de registros.", maximum: 100 },
  },
  governance: {
    maxRows: 50,
    requireAtLeastOneFilter: true,
    filterParamNames: ["codCliente", "nomeCliente"],
    maskedColumns: ["CNPJ"],
  },
  executionConfig: {
    providerType: "sql",
    sql: "SELECT TOP :limite c.Nome FROM Cliente c",
    channel: "rest",
    maxRows: 50,
  },
});

describe("mcp governance", () => {
  it("should reject execution when no business filter is provided", () => {
    const result = enforceGovernance(capability(), { limite: 10 });

    expect(result).toEqual({
      ok: false,
      error: "At least one business filter is required before running this capability.",
    });
  });

  it("should reject limits above governance maxRows", () => {
    const result = enforceGovernance(capability(), {
      codCliente: 42,
      limite: 80,
    });

    expect(result).toEqual({
      ok: false,
      error: "Result limit cannot exceed 50 rows.",
    });
  });

  it("should mask sensitive columns before returning data", () => {
    const masked = maskSensitiveColumns(
      [{ Nome: "Joao", CNPJ: "12345678901234" }],
      ["CNPJ"],
    );

    expect(masked).toEqual([{ Nome: "Joao", CNPJ: "[redacted]" }]);
  });
});
