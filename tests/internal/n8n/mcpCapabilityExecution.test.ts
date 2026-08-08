import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { CapabilityDefinition } from "../../../shared/mcp/contracts";
import { PlugValidationError } from "../../../shared/contracts/errors";
import {
  executeSqlCapability,
  executeToolsCapability,
  resolveToolsMergedParams,
} from "../../../shared/n8n/mcpCapabilityExecution";
import { createMockExecuteContext } from "../../helpers/mockExecuteFunctions";

const credentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const loadFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../fixtures/plug/${name}`, import.meta.url), "utf8"),
  ) as T;

const sqlCapability = (sql: string, maxRows = 50): CapabilityDefinition => ({
  name: "consultar_cliente",
  displayName: "Consultar Cliente",
  description: "Busca clientes.",
  whenToUse: "Use para identificar clientes.",
  whenNotToUse: "Nao use para financeiro.",
  category: "crm",
  parameters: {
    nomeCliente: { type: "string", description: "Nome." },
    limite: { type: "number", description: "Limite.", default: 10, maximum: 50 },
  },
  governance: {
    maxRows,
    maskedColumns: ["CNPJ"],
  },
  executionConfig: {
    providerType: "sql",
    sql,
    channel: "rest",
    maxRows: maxRows * 2,
  },
});

const toolsCapability = (): CapabilityDefinition => ({
  name: "validar_documento",
  displayName: "Validar CPF/CNPJ",
  description: "Valida documento brasileiro.",
  whenToUse: "Use para validar CPF ou CNPJ.",
  whenNotToUse: "Nao use para consultas SQL.",
  category: "compliance",
  parameters: {
    document: { type: "string", description: "CPF ou CNPJ.", required: true },
    limite: { type: "number", description: "Limite.", default: 10, maximum: 10 },
  },
  governance: {
    maxRows: 10,
  },
  executionConfig: {
    providerType: "tools",
    operation: "validateCpfCnpj",
  },
});

describe("mcpCapabilityExecution", () => {
  it("should reject mutating SQL before calling the hub", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        agentId: "agent-1",
        clientToken: "client-token",
      },
      responses: [],
    });

    await expect(
      executeSqlCapability(
        context,
        sqlCapability("UPDATE Cliente SET Ativo = 0 WHERE CodCliente = :codCliente"),
        { codCliente: 1, limite: 10 },
        {
          supportsSocket: false,
          credentialName: "plugDatabaseAccountApi",
          nodeDisplayName: "Plug MCP Server",
        },
      ),
    ).rejects.toBeInstanceOf(PlugValidationError);

    expect(context.httpRequestMock).not.toHaveBeenCalled();
  });

  it("should execute SQL capabilities with unified max_rows and column masking", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
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

    const result = await executeSqlCapability(
      context,
      sqlCapability(
        "SELECT TOP :limite c.Nome, c.CNPJ FROM Cliente c WHERE (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)",
        50,
      ),
      { nomeCliente: "Joao%", limite: 10 },
      {
        supportsSocket: false,
        credentialName: "plugDatabaseAccountApi",
        nodeDisplayName: "Plug MCP Server",
      },
    );

    expect(result.effectiveMaxRows).toBe(10);
    expect(result.rows).toEqual([{ Nome: "Joao", CNPJ: "[redacted]" }]);
    expect(result.rowCount).toBe(1);
    expect(result.emptyResult).toBe(false);

    expect(context.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      command: {
        method: "sql.execute",
        params: {
          options: {
            max_rows: 10,
          },
        },
      },
    });
  });

  it("should honor limite when resolving effectiveMaxRows for tools capabilities", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        agentId: "agent-1",
        clientToken: "client-token",
      },
      responses: [],
    });

    const result = await executeToolsCapability(
      context,
      toolsCapability(),
      { document: "39053344705", limite: 3 },
      {
        supportsSocket: false,
        credentialName: "plugDatabaseAccountApi",
        nodeDisplayName: "Plug MCP Server",
      },
    );

    expect(result.effectiveMaxRows).toBe(3);
    expect(result.emptyResult).toBe(false);
    expect(result.rowCount).toBe(1);
  });

  it("should let staticParams override AI-provided tools params", () => {
    expect(
      resolveToolsMergedParams(
        { document: "from-ai", eventName: "client:custom.fromAi" },
        { eventName: "client:custom.locked" },
        "publishSocketEvent",
      ),
    ).toEqual({
      document: "from-ai",
      eventName: "client:custom.locked",
      operation: "publishSocketEvent",
      resource: "tools",
    });
  });
});
