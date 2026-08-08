import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildRegistry, listCapabilities } from "../../../shared/mcp/registry";
import { parseCapabilityDefinition } from "../../../packages/n8n-nodes-plug-database/nodes/PlugMcpServer/mcpServerHelpers";

describe("pilot capability pack", () => {
  it("should parse the documented pilot pack without validation errors", () => {
    const raw = JSON.parse(
      readFileSync(
        new URL(
          "../../../docs/mcp-hub/examples/pilot-capabilities.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ) as unknown[];

    const definitions = raw.map((entry, index) =>
      parseCapabilityDefinition(entry, index),
    );
    const registry = buildRegistry(definitions);
    const tools = listCapabilities(registry);

    expect(definitions).toHaveLength(8);
    expect(tools).toHaveLength(8);
    expect(tools.map((tool) => tool.name)).toEqual([
      "consultar_cliente",
      "contas_receber_vencidas",
      "contas_receber_a_vencer",
      "saldo_estoque",
      "consultar_produto",
      "publicar_evento_status",
      "validar_documento",
      "gerar_pdf_documento",
    ]);
  });
});
