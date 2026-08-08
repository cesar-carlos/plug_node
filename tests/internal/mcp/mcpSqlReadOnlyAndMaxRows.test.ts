import { describe, expect, it } from "vitest";

import type { CapabilityDefinition } from "../../../shared/mcp/contracts";
import { assertSqlIsReadOnly } from "../../../shared/n8n/plugSqlGuidedCommands";
import { PlugValidationError } from "../../../shared/contracts/errors";
import {
  resolveEffectiveMaxRows,
  enforceGovernance,
} from "../../../shared/mcp/governance";

const capability = (overrides?: {
  readonly governanceMaxRows?: number;
  readonly executionMaxRows?: number;
}): CapabilityDefinition => ({
  name: "consultar_cliente",
  displayName: "Consultar Cliente",
  description: "Busca clientes.",
  whenToUse: "Use para identificar clientes.",
  whenNotToUse: "Nao use para financeiro.",
  category: "crm",
  parameters: {
    codCliente: { type: "number", description: "Codigo do cliente." },
    ativo: { type: "boolean", description: "Somente ativos." },
    limite: { type: "number", description: "Limite de registros.", maximum: 100 },
  },
  governance: {
    maxRows: overrides?.governanceMaxRows ?? 50,
    requireAtLeastOneFilter: true,
    filterParamNames: ["codCliente", "ativo"],
  },
  executionConfig: {
    providerType: "sql",
    sql: "SELECT TOP :limite c.Nome FROM Cliente c",
    channel: "rest",
    maxRows: overrides?.executionMaxRows ?? 100,
  },
});

describe("assertSqlIsReadOnly", () => {
  it("should accept SELECT and CTE SELECT statements", () => {
    expect(() =>
      assertSqlIsReadOnly("SELECT TOP 10 Nome FROM Cliente", "SQL"),
    ).not.toThrow();
    expect(() =>
      assertSqlIsReadOnly("WITH cte AS (SELECT 1 AS n) SELECT n FROM cte", "SQL"),
    ).not.toThrow();
  });

  it("should reject mutating SQL even with WHERE", () => {
    expect(() =>
      assertSqlIsReadOnly("UPDATE Cliente SET Ativo = 0 WHERE CodCliente = 1", "SQL"),
    ).toThrow(PlugValidationError);
    expect(() =>
      assertSqlIsReadOnly("DELETE FROM Cliente WHERE CodCliente = 1", "SQL"),
    ).toThrow(PlugValidationError);
    expect(() =>
      assertSqlIsReadOnly("INSERT INTO Cliente (Nome) VALUES ('x')", "SQL"),
    ).toThrow(PlugValidationError);
  });
});

describe("mcp governance extras", () => {
  it("should treat whitespace as inactive and boolean false as an active filter", () => {
    expect(
      enforceGovernance(capability(), {
        ativo: false,
        limite: 10,
      }),
    ).toEqual({ ok: true });

    expect(
      enforceGovernance(capability(), {
        codCliente: "   ",
        limite: 10,
      }),
    ).toEqual({
      ok: false,
      error: "At least one business filter is required before running this capability.",
    });

    expect(
      enforceGovernance(capability(), {
        ativo: true,
        limite: 10,
      }),
    ).toEqual({ ok: true });
  });

  it("should unify effective maxRows across governance, execution, and limite", () => {
    expect(
      resolveEffectiveMaxRows(
        capability({ governanceMaxRows: 50, executionMaxRows: 100 }),
        {
          limite: 80,
          codCliente: 1,
        },
      ),
    ).toBe(50);

    expect(
      resolveEffectiveMaxRows(
        capability({ governanceMaxRows: 50, executionMaxRows: 20 }),
        {
          limite: 40,
          codCliente: 1,
        },
      ),
    ).toBe(20);

    expect(
      resolveEffectiveMaxRows(
        capability({ governanceMaxRows: 50, executionMaxRows: 100 }),
        {
          limite: 10,
          codCliente: 1,
        },
      ),
    ).toBe(10);
  });
});
