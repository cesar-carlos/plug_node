import { readFileSync } from "node:fs";

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

const loadFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/plug/${name}`, import.meta.url), "utf8"),
  ) as T;

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
      maskedColumns: ["CNPJ"],
    },
    executionConfig: {
      providerType: "sql",
      sql: "SELECT TOP :limite c.Nome, c.CNPJ FROM Cliente c WHERE (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)",
      channel: "rest",
      maxRows: 100,
    },
  },
  {
    name: "client_access",
    displayName: "Client Access",
    description: "Admin capability that must stay blocked.",
    whenToUse: "Never for agents.",
    whenNotToUse: "Always.",
    category: "admin",
    parameters: {},
    governance: { maxRows: 10 },
    executionConfig: {
      providerType: "sql",
      sql: "SELECT 1",
      channel: "rest",
      maxRows: 10,
    },
  },
  {
    name: "validar_documento",
    displayName: "Validar CPF/CNPJ",
    description: "Valida documento brasileiro.",
    whenToUse: "Use para validar CPF ou CNPJ.",
    whenNotToUse: "Nao use para consultas SQL.",
    category: "compliance",
    parameters: {
      document: {
        type: "string",
        description: "CPF ou CNPJ.",
        required: true,
      },
    },
    governance: { maxRows: 1 },
    executionConfig: {
      providerType: "tools",
      operation: "validateCpfCnpj",
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
      "validate",
    ]);
  });

  it("should return a friendly error when calling with an empty registry", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "consultar_cliente",
        capabilityParamsJson: "{}",
        capabilityDefinitionsJson: "[]",
        auditUserId: "user-1",
        auditSessionId: "session-1",
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain("No capabilities are registered");
  });

  it("should validate capability definitions without executing", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "validate",
        authoringMode: "json",
        capabilityDefinitionsJson: JSON.stringify(
          sampleCapabilityDefinitions.filter(
            (capability) => capability.name !== "client_access",
          ),
        ),
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    expect(result[0][0].json).toMatchObject({
      valid: true,
      capabilityCount: 2,
    });
  });

  it("should fail validate when admin capabilities are present", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "validate",
        authoringMode: "json",
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    expect(result[0][0].json).toMatchObject({
      valid: false,
      forbiddenCapabilities: ["client_access"],
    });
  });

  it("should omit audit when includeAuditInOutput is false", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "validar_documento",
        capabilityParamsJson: JSON.stringify({ document: "39053344705" }),
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
        includeAuditInOutput: false,
        auditUserId: "user-1",
        auditSessionId: "session-1",
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as Record<string, unknown>;

    expect(payload.isError).toBeUndefined();
    expect(payload.audit).toBeUndefined();
    expect(payload.content).toBeDefined();
  });

  it("should return tools/list payload and hide forbidden capability names", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "list",
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
        forbiddenCapabilityNamesJson: JSON.stringify(["consultar_cliente"]),
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    const tools = (result[0][0].json as { tools: Array<{ name: string }> }).tools;

    expect(tools.map((tool) => tool.name)).toEqual(["validar_documento"]);
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

  it("should return a friendly error for unknown capabilities with audit", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "missing_capability",
        capabilityParamsJson: "{}",
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
      audit?: { isError?: boolean };
    };

    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain(
      'Capability "missing_capability" is not registered.',
    );
    expect(payload.audit?.isError).toBe(true);
  });

  it("should reject forbidden admin capabilities with MCP error envelope", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "client_access",
        capabilityParamsJson: "{}",
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
      audit?: { isError?: boolean };
    };

    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain("forbidden administration");
    expect(payload.audit?.isError).toBe(true);
  });

  it("should enforce max tool calls per turn", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "consultar_cliente",
        capabilityParamsJson: JSON.stringify({ nomeCliente: "Joao%", limite: 10 }),
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
        maxToolCallsPerTurn: 2,
        toolCallCount: 3,
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };

    expect(payload.isError).toBe(true);
    expect(payload.content[0]?.text).toContain("tool calls per turn exceeded");
  });

  it("should treat omitted toolCallCount as 1 when maxToolCallsPerTurn is set", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "consultar_cliente",
        capabilityParamsJson: JSON.stringify({ nomeCliente: "Joao%", limite: 10 }),
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
        maxToolCallsPerTurn: 1,
        toolCallCount: 0,
        auditUserId: "user-1",
        auditSessionId: "session-1",
        agentId: "agent-1",
        clientToken: "client-token",
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            mode: "bridge",
            agentId: "agent-1",
            requestId: "request-1",
            response: {
              type: "single",
              success: true,
              item: {
                id: "rpc-1",
                success: true,
                result: {
                  rows: [{ Nome: "Joao", CNPJ: "12345678901234" }],
                  rowCount: 1,
                },
              },
            },
          },
        },
      ],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as { isError?: boolean };

    // count defaults to 1 and max is 1 → allowed (1 > 1 is false)
    expect(payload.isError).toBeUndefined();
  });

  it("should execute a successful SQL capability call", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "consultar_cliente",
        capabilityParamsJson: JSON.stringify({ nomeCliente: "Joao%", limite: 10 }),
        capabilityDefinitionsJson: JSON.stringify(sampleCapabilityDefinitions),
        auditUserId: "user-1",
        auditSessionId: "session-1",
        agentId: "agent-1",
        clientToken: "client-token",
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            mode: "bridge",
            agentId: "agent-1",
            requestId: "request-1",
            response: {
              type: "single",
              success: true,
              item: {
                id: "rpc-1",
                success: true,
                result: {
                  rows: [{ Nome: "Joao", CNPJ: "12345678901234" }],
                  rowCount: 1,
                },
              },
            },
          },
        },
      ],
    });

    const result = await node.execute.call(context);
    const payload = result[0][0].json as {
      isError?: boolean;
      content: Array<{ text: string }>;
      meta: { truncated?: boolean; emptyResult?: boolean; rowCount?: number };
      audit?: { rowCount?: number };
    };

    expect(payload.isError).toBeUndefined();
    expect(payload.meta).toMatchObject({
      rowCount: 1,
      emptyResult: false,
      truncated: false,
    });
    expect(JSON.parse(payload.content[0]?.text ?? "[]")).toEqual([
      { Nome: "Joao", CNPJ: "[redacted]" },
    ]);
    expect(payload.audit?.rowCount).toBe(1);
  });

  it("should execute a tools capability call", async () => {
    const node = new PlugMcpServer();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "call",
        capabilityName: "validar_documento",
        capabilityParamsJson: JSON.stringify({ document: "39053344705" }),
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
      meta: { emptyResult?: boolean; rowCount?: number };
    };

    expect(payload.isError).toBeUndefined();
    expect(payload.meta.emptyResult).toBe(false);
    expect(payload.meta.rowCount).toBe(1);
    const rows = JSON.parse(payload.content[0]?.text ?? "[]") as unknown[];
    expect(rows).toHaveLength(1);
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
      wiring: {
        systemPrompt: expect.stringContaining("Voce e o assistente comercial."),
        maxToolCallsPerTurn: 5,
        forbiddenCapabilityNamesJson: JSON.stringify(["client_access"]),
      },
    });
  });

  it("should clamp invalid maxToolCallsPerTurn values", async () => {
    const node = new PlugAiHub();
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        maxToolCallsPerTurn: 0,
      },
      responses: [],
    });

    const result = await node.execute.call(context);
    expect(result[0][0].json).toMatchObject({
      maxToolCallsPerTurn: 1,
    });
  });
});
