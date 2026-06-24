import { describe, expect, it } from "vitest";

import type { CapabilityDefinition } from "../../../shared/mcp/contracts";
import {
  buildRegistry,
  listCapabilities,
  lookupCapability,
} from "../../../shared/mcp/registry";

const sampleCapability = (name: string): CapabilityDefinition => ({
  name,
  displayName: "Consultar Cliente",
  description: "Busca dados cadastrais de clientes.",
  whenToUse: "Use para identificar clientes.",
  whenNotToUse: "Nao use para financeiro.",
  category: "crm",
  tags: ["cliente", "cadastro"],
  parameters: {
    nomeCliente: {
      type: "string",
      description: "Nome parcial do cliente.",
    },
    limite: {
      type: "number",
      description: "Quantidade maxima de registros.",
      default: 10,
      maximum: 50,
    },
  },
  governance: {
    maxRows: 50,
    requireAtLeastOneFilter: true,
    filterParamNames: ["nomeCliente"],
  },
  executionConfig: {
    providerType: "sql",
    sql: "SELECT TOP :limite c.Nome FROM Cliente c WHERE (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)",
    channel: "rest",
    maxRows: 50,
  },
});

describe("mcp registry", () => {
  it("should build an immutable registry and list tool schemas", () => {
    const registry = buildRegistry([sampleCapability("consultar_cliente")]);
    const tools = listCapabilities(registry);

    expect(tools).toHaveLength(1);
    expect(tools[0]).toMatchObject({
      name: "consultar_cliente",
      inputSchema: {
        type: "object",
        properties: {
          nomeCliente: {
            type: "string",
            description: "Nome parcial do cliente.",
          },
          limite: {
            type: "number",
            description: "Quantidade maxima de registros.",
            default: 10,
            maximum: 50,
          },
        },
      },
    });
    expect(tools[0]?.description).toContain("When to use:");
    expect(tools[0]?.description).toContain("Tags: cliente, cadastro");
  });

  it("should lookup capabilities by technical name", () => {
    const registry = buildRegistry([sampleCapability("consultar_cliente")]);

    expect(lookupCapability(registry, "consultar_cliente")?.displayName).toBe(
      "Consultar Cliente",
    );
    expect(lookupCapability(registry, "missing")).toBeUndefined();
  });

  it("should reject duplicate capability names", () => {
    expect(() =>
      buildRegistry([
        sampleCapability("consultar_cliente"),
        sampleCapability("consultar_cliente"),
      ]),
    ).toThrow("Duplicate capability name: consultar_cliente");
  });
});
