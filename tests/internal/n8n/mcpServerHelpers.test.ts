import { describe, expect, it } from "vitest";

import {
  parseCapabilityDefinitions,
  parseCapabilityParams,
  readForbiddenCapabilityNames,
  readToolCallBudget,
} from "../../../packages/n8n-nodes-plug-database/nodes/PlugMcpServer/mcpServerHelpers";
import { createMockExecuteContext } from "../../helpers/mockExecuteFunctions";

const credentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const validCapability = {
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
      minimum: 1,
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
    maxRows: 100,
  },
};

const parseWithDefinitions = (definitions: unknown[]) => {
  const context = createMockExecuteContext({
    credentials,
    parameters: {
      capabilityDefinitionsJson: JSON.stringify(definitions),
    },
    responses: [],
  });
  return parseCapabilityDefinitions(context, 0);
};

describe("mcpServerHelpers parseCapabilityDefinitions", () => {
  it("should accept a valid capability definition", () => {
    const definitions = parseWithDefinitions([validCapability]);

    expect(definitions).toHaveLength(1);
    expect(definitions[0]?.name).toBe("consultar_cliente");
    expect(definitions[0]?.governance.maxRows).toBe(50);
    expect(definitions[0]?.parameters.limite?.minimum).toBe(1);
    expect(definitions[0]?.parameters.limite?.maximum).toBe(50);
  });

  it("should reject governance.maxRows set to null (NaN JSON round-trip)", () => {
    expect(() =>
      parseWithDefinitions([
        {
          ...validCapability,
          governance: { ...validCapability.governance, maxRows: null },
        },
      ]),
    ).toThrow(/governance\.maxRows must be a positive integer/);
  });

  it("should reject governance.maxRows set to a float", () => {
    expect(() =>
      parseWithDefinitions([
        {
          ...validCapability,
          governance: { ...validCapability.governance, maxRows: 50.5 },
        },
      ]),
    ).toThrow(/governance\.maxRows must be a positive integer/);
  });

  it("should reject executionConfig.maxRows set to null (NaN JSON round-trip)", () => {
    expect(() =>
      parseWithDefinitions([
        {
          ...validCapability,
          executionConfig: {
            ...validCapability.executionConfig,
            maxRows: null,
          },
        },
      ]),
    ).toThrow(/executionConfig\.maxRows must be a positive integer/);
  });

  it("should omit non-finite minimum and maximum from param schemas", () => {
    // JSON cannot encode NaN/Infinity; they become null and must be ignored.
    const definitions = parseWithDefinitions([
      {
        ...validCapability,
        parameters: {
          ...validCapability.parameters,
          limite: {
            type: "number",
            description: "Quantidade maxima de registros.",
            default: 10,
            maximum: null,
            minimum: null,
          },
        },
      },
    ]);

    expect(definitions[0]?.parameters.limite).toEqual({
      type: "number",
      description: "Quantidade maxima de registros.",
      default: 10,
    });
    expect(definitions[0]?.parameters.limite).not.toHaveProperty("minimum");
    expect(definitions[0]?.parameters.limite).not.toHaveProperty("maximum");
  });

  it("should reject filterParamNames that are not declared in parameters", () => {
    expect(() =>
      parseWithDefinitions([
        {
          ...validCapability,
          governance: {
            ...validCapability.governance,
            filterParamNames: ["nomeCliente", "nonExistentParam"],
          },
        },
      ]),
    ).toThrow(
      /filterParamNames includes "nonExistentParam" which is not defined in parameters/,
    );
  });

  it("should reject SQL bindings that are not declared in parameters", () => {
    expect(() =>
      parseWithDefinitions([
        {
          ...validCapability,
          executionConfig: {
            ...validCapability.executionConfig,
            sql: "SELECT TOP :limite c.Nome FROM Cliente c WHERE c.CodCliente = :nonExistent",
          },
        },
      ]),
    ).toThrow(
      /executionConfig\.sql references ":nonExistent" which is not defined in parameters/,
    );
  });

  it("should ignore colon tokens inside SQL string literals when cross-checking bindings", () => {
    const definitions = parseWithDefinitions([
      {
        ...validCapability,
        executionConfig: {
          ...validCapability.executionConfig,
          sql: "SELECT TOP :limite c.Nome FROM Cliente c WHERE c.Obs = 'ratio:1' AND (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)",
        },
      },
    ]);

    expect(definitions).toHaveLength(1);
  });

  it("should accept string integer maxRows from visual-style inputs", () => {
    const definitions = parseWithDefinitions([
      {
        ...validCapability,
        governance: {
          ...validCapability.governance,
          maxRows: "50",
        },
        executionConfig: {
          ...validCapability.executionConfig,
          maxRows: "100",
        },
      },
    ]);

    expect(definitions[0]?.governance.maxRows).toBe(50);
    expect(
      definitions[0]?.executionConfig.providerType === "sql"
        ? definitions[0].executionConfig.maxRows
        : undefined,
    ).toBe(100);
  });

  it("should parse visual builder capability definitions", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        authoringMode: "visual",
        capabilitiesBuilder: {
          values: [
            {
              name: "validar_documento",
              displayName: "Validar CPF/CNPJ",
              description: "Valida documento.",
              whenToUse: "Use para validar CPF.",
              whenNotToUse: "Nao use para SQL.",
              category: "compliance",
              tags: "cpf, cnpj",
              maxRows: 1,
              requireAtLeastOneFilter: false,
              filterParamNames: "",
              maskedColumns: "",
              providerType: "tools",
              toolsOperation: "validateCpfCnpj",
              staticParamsJson: "{}",
              parameters: {
                values: [
                  {
                    name: "document",
                    type: "string",
                    description: "CPF ou CNPJ.",
                    required: true,
                    defaultValue: "",
                  },
                ],
              },
            },
          ],
        },
      },
      responses: [],
    });

    const definitions = parseCapabilityDefinitions(context, 0);
    expect(definitions).toHaveLength(1);
    expect(definitions[0]).toMatchObject({
      name: "validar_documento",
      executionConfig: {
        providerType: "tools",
        operation: "validateCpfCnpj",
      },
      parameters: {
        document: {
          type: "string",
          required: true,
        },
      },
    });
  });

  it("should parse resource mapper capability params", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        paramsInputMode: "mapper",
        capabilityParamsMapper: {
          mappingMode: "defineBelow",
          value: {
            document: "39053344705",
          },
          matchingColumns: [],
          schema: [],
          attemptToConvertTypes: false,
          convertFieldsToString: false,
        },
      },
      responses: [],
    });

    expect(parseCapabilityParams(context, 0)).toEqual({
      document: "39053344705",
    });
  });
});

describe("mcpServerHelpers readToolCallBudget", () => {
  it("should default toolCallCount to 1 when max is set and count is omitted", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        maxToolCallsPerTurn: 3,
        toolCallCount: 0,
      },
      responses: [],
    });

    expect(readToolCallBudget(context, 0)).toEqual({
      maxToolCallsPerTurn: 3,
      toolCallCount: 1,
    });
  });

  it("should keep toolCallCount at 0 when budget is disabled", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        maxToolCallsPerTurn: 0,
        toolCallCount: 0,
      },
      responses: [],
    });

    expect(readToolCallBudget(context, 0)).toEqual({
      maxToolCallsPerTurn: 0,
      toolCallCount: 0,
    });
  });

  it("should inherit budget and forbidden names from input wiring when params are default", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        maxToolCallsPerTurn: 0,
        toolCallCount: 0,
        forbiddenCapabilityNamesJson: "[]",
      },
      responses: [],
      inputData: [
        {
          json: {
            wiring: {
              maxToolCallsPerTurn: 4,
              forbiddenCapabilityNamesJson: JSON.stringify(["blocked_tool"]),
            },
          },
        },
      ],
    });

    expect(readToolCallBudget(context, 0)).toEqual({
      maxToolCallsPerTurn: 4,
      toolCallCount: 1,
    });
    expect(readForbiddenCapabilityNames(context, 0)).toEqual(["blocked_tool"]);
  });

  it("should resolve Hub wiring from aiHubNodeName via evaluateExpression", () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        maxToolCallsPerTurn: 0,
        toolCallCount: 0,
        forbiddenCapabilityNamesJson: "[]",
        aiHubNodeName: "Plug AI Hub",
      },
      responses: [],
      evaluateExpression: (expression) => {
        expect(expression).toContain("Plug AI Hub");
        return {
          wiring: {
            maxToolCallsPerTurn: 2,
            forbiddenCapabilityNamesJson: JSON.stringify(["from_hub"]),
          },
        };
      },
    });

    expect(readToolCallBudget(context, 0)).toEqual({
      maxToolCallsPerTurn: 2,
      toolCallCount: 1,
    });
    expect(readForbiddenCapabilityNames(context, 0)).toEqual(["from_hub"]);
  });
});
