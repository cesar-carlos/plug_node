import { describe, expect, it } from "vitest";

import { PlugMcpServer } from "../../packages/n8n-nodes-plug-database/nodes/PlugMcpServer/PlugMcpServer.node";
import { PlugAiHub } from "../../packages/n8n-nodes-plug-database/nodes/PlugAiHub/PlugAiHub.node";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";
import type { PlugCredentials } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";

const credentials: PlugCredentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const sampleCapabilityDefinitions = [
  {
    name: "consultar_cliente",
    displayName: "Consultar Cliente",
    description: "Busca dados cadastrais de clientes.",
    whenToUse: "Use para identificar clientes.",
    whenNotToUse: "Nao use para financeiro.",
    category: "crm",
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
  },
];

describe("Plug MCP Server node", () => {
  it("should expose list and call operations in the node description", () => {
    const node = new PlugMcpServer();

    expect(node.description).toMatchObject({
      displayName: "Plug MCP Server",
      name: "plugMcpServer",
      version: 1,
    });

    const operationProperty = node.description.properties.find(
      (property) => property.name === "operation",
    );
    expect(operationProperty?.options?.map((option) => option.value)).toEqual([
      "list",
      "call",
    ]);
  });

  it("should return tools/list payload for list operation", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "list",
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
      },
      responses: [],
    });

    const result = await node.execute.call(context);

    expect(result[0][0].json).toMatchObject({
      protocolVersion: "2024-11-05",
      tools: [
        expect.objectContaining({
          name: "consultar_cliente",
        }),
      ],
    });
  });

  it("should reject call operation when governance requires a missing filter", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "consultar_cliente",
        capabilityParamsJson: JSON.stringify({ limite: 10 }),
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
        auditUserId: "user-1",
        auditSessionId: "session-1",
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as {
      isError?: boolean;
      content: Array<{ text: string }>;
      audit: { errorMessage?: string };
    };

    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain(
      "At least one business filter is required",
    );
    expect(payload.audit.errorMessage).toContain(
      "At least one business filter is required",
    );
  });

  it("should return a friendly error for unknown capabilities", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "missing_capability",
        capabilityParamsJson: "{}",
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain(
      'Capability "missing_capability" is not registered.',
    );
  });
});

describe("Plug AI Hub node", () => {
  it("should emit the configured system prompt and limits", async () => {
    const node = new PlugAiHub();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        identity: "Voce e o assistente comercial.",
        scope: "Consulte clientes e estoque.",
        maxToolCallsPerTurn: 5,
        forbiddenCapabilityNamesJson: JSON.stringify(["client_access"]),
      },
      responses: [],
    });

    const result = await node.execute.call(context);

    expect(result[0][0].json).toMatchObject({
      maxToolCallsPerTurn: 5,
      forbiddenCapabilityNames: ["client_access"],
      systemPrompt: expect.stringContaining("Voce e o assistente comercial."),
    });
  });
});
