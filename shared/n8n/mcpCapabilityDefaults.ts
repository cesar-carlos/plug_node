import type { CapabilityDefinition } from "../mcp/contracts";

/** Minimal side-effect-free tools capability used as the MCP Server node default. */
export const DEFAULT_MCP_EXAMPLE_CAPABILITY: CapabilityDefinition = {
  name: "validar_documento",
  displayName: "Validar CPF/CNPJ",
  description: "Valida um CPF ou CNPJ brasileiro e retorna o resultado da validacao.",
  whenToUse: "Use para validar CPF ou CNPJ informado pelo usuario.",
  whenNotToUse: "Nao use para consultas SQL, financeiro ou cadastro de clientes.",
  category: "compliance",
  tags: ["cpf", "cnpj", "documento", "validacao"],
  parameters: {
    document: {
      type: "string",
      description: "CPF ou CNPJ a validar.",
      required: true,
    },
  },
  governance: {
    maxRows: 1,
  },
  executionConfig: {
    providerType: "tools",
    operation: "validateCpfCnpj",
  },
};

export const DEFAULT_MCP_CAPABILITY_DEFINITIONS_JSON = JSON.stringify(
  [DEFAULT_MCP_EXAMPLE_CAPABILITY],
  null,
  2,
);

export const DEFAULT_MCP_CAPABILITY_PARAMS_EXAMPLE =
  'Example for the default capability: { "document": "39053344705" }';
