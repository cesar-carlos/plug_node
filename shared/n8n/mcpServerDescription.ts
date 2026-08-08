import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import { MCP_PROTOCOL_VERSION } from "../mcp/contracts";
import {
  DEFAULT_MCP_CAPABILITY_DEFINITIONS_JSON,
  DEFAULT_MCP_CAPABILITY_PARAMS_EXAMPLE,
} from "./mcpCapabilityDefaults";

export interface McpServerDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly credentialName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

const capabilityParameterFields: INodeProperties[] = [
  {
    displayName: "Name",
    name: "name",
    type: "string",
    default: "",
    required: true,
    description: "Technical parameter name used in SQL bindings and tool params.",
  },
  {
    displayName: "Type",
    name: "type",
    type: "options",
    default: "string",
    options: [
      { name: "String", value: "string" },
      { name: "Number", value: "number" },
      { name: "Boolean", value: "boolean" },
      { name: "Object", value: "object" },
    ],
  },
  {
    displayName: "Description",
    name: "description",
    type: "string",
    default: "",
    required: true,
  },
  {
    displayName: "Required",
    name: "required",
    type: "boolean",
    default: false,
  },
  {
    displayName: "Default",
    name: "defaultValue",
    type: "string",
    default: "",
    description:
      "Optional default value as text. Numbers and booleans are coerced at runtime.",
  },
  {
    displayName: "Minimum",
    name: "minimum",
    type: "number",
    default: 0,
    displayOptions: {
      show: {
        type: ["number"],
      },
    },
  },
  {
    displayName: "Maximum",
    name: "maximum",
    type: "number",
    default: 100,
    displayOptions: {
      show: {
        type: ["number"],
      },
    },
  },
];

const capabilityBuilderValues: INodeProperties[] = [
  {
    displayName: "Name",
    name: "name",
    type: "string",
    default: "",
    required: true,
    description: "Technical capability name, for example consultar_cliente.",
  },
  {
    displayName: "Display Name",
    name: "displayName",
    type: "string",
    default: "",
    required: true,
  },
  {
    displayName: "Description",
    name: "description",
    type: "string",
    typeOptions: { rows: 3 },
    default: "",
    required: true,
  },
  {
    displayName: "When To Use",
    name: "whenToUse",
    type: "string",
    typeOptions: { rows: 2 },
    default: "",
    required: true,
  },
  {
    displayName: "When Not To Use",
    name: "whenNotToUse",
    type: "string",
    typeOptions: { rows: 2 },
    default: "",
    required: true,
  },
  {
    displayName: "Category",
    name: "category",
    type: "string",
    default: "crm",
    required: true,
  },
  {
    displayName: "Tags",
    name: "tags",
    type: "string",
    default: "",
    description: "Comma-separated semantic tags for agent discovery.",
  },
  {
    displayName: "Parameters",
    name: "parameters",
    type: "fixedCollection",
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: "Add Parameter",
    options: [
      {
        displayName: "Parameter",
        name: "values",
        values: capabilityParameterFields,
      },
    ],
  },
  {
    displayName: "Max Rows",
    name: "maxRows",
    type: "number",
    default: 50,
    typeOptions: { minValue: 1, maxValue: 1000 },
    description: "Governance ceiling for returned rows.",
  },
  {
    displayName: "Require At Least One Filter",
    name: "requireAtLeastOneFilter",
    type: "boolean",
    default: false,
  },
  {
    displayName: "Filter Param Names",
    name: "filterParamNames",
    type: "string",
    default: "",
    description:
      "Comma-separated parameter names that count as business filters. Must match Parameters above.",
  },
  {
    displayName: "Masked Columns",
    name: "maskedColumns",
    type: "string",
    default: "",
    description: "Comma-separated result column names replaced with [redacted].",
  },
  {
    displayName: "Provider Type",
    name: "providerType",
    type: "options",
    default: "sql",
    options: [
      { name: "SQL", value: "sql" },
      { name: "Tools", value: "tools" },
    ],
  },
  {
    displayName: "SQL",
    name: "sql",
    type: "string",
    typeOptions: {
      rows: 6,
      editor: "sqlEditor",
    },
    default: "",
    displayOptions: {
      show: {
        providerType: ["sql"],
      },
    },
    description: "Read-only guided SQL with named bindings such as :limite.",
  },
  {
    displayName: "Channel",
    name: "channel",
    type: "options",
    default: "rest",
    options: [
      { name: "REST", value: "rest" },
      { name: "Socket", value: "socket" },
    ],
    displayOptions: {
      show: {
        providerType: ["sql"],
      },
    },
  },
  {
    displayName: "Execution Max Rows",
    name: "executionMaxRows",
    type: "number",
    default: 50,
    typeOptions: { minValue: 1, maxValue: 1000 },
    displayOptions: {
      show: {
        providerType: ["sql"],
      },
    },
  },
  {
    displayName: "Tools Operation",
    name: "toolsOperation",
    type: "string",
    default: "",
    displayOptions: {
      show: {
        providerType: ["tools"],
      },
    },
    description: "Plug Tools operation name, for example validateCpfCnpj.",
  },
  {
    displayName: "Static Params JSON",
    name: "staticParamsJson",
    type: "json",
    default: "{}",
    displayOptions: {
      show: {
        providerType: ["tools"],
      },
    },
  },
];

const buildOperationProperties = (): INodeProperties[] => [
  {
    displayName:
      "Wire Forbidden Capability Names JSON and Max Tool Calls Per Turn from Plug AI Hub output for consistent governance across both nodes.",
    name: "wiringNotice",
    type: "notice",
    default: "",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    default: "list",
    noDataExpression: true,
    options: [
      {
        name: "List Capabilities",
        value: "list",
        description: "Return the MCP tools/list payload for connected AI agents.",
      },
      {
        name: "Call Capability",
        value: "call",
        description:
          "Validate parameters, execute a capability, and return a normalized MCP response.",
      },
      {
        name: "Validate Definitions",
        value: "validate",
        description:
          "Parse and validate capability definitions without executing any capability.",
      },
    ],
  },
  {
    displayName: "Authoring Mode",
    name: "authoringMode",
    type: "options",
    default: "json",
    noDataExpression: true,
    options: [
      {
        name: "JSON",
        value: "json",
        description: "Edit the full capability registry as Capability Definitions JSON.",
      },
      {
        name: "Visual Builder",
        value: "visual",
        description: "Build capabilities with structured form fields.",
      },
    ],
    description:
      "Choose how capability definitions are authored. JSON remains the advanced escape hatch.",
  },
  {
    displayName: "Capability Definitions JSON",
    name: "capabilityDefinitionsJson",
    type: "json",
    default: DEFAULT_MCP_CAPABILITY_DEFINITIONS_JSON,
    required: true,
    displayOptions: {
      show: {
        authoringMode: ["json"],
      },
    },
    description:
      "Array of capability definitions with semantic contract, governance, and SQL/Tools execution config. See docs/mcp-hub/examples/pilot-capabilities.json for the full pilot pack.",
  },
  {
    displayName: "Capabilities",
    name: "capabilitiesBuilder",
    type: "fixedCollection",
    typeOptions: { multipleValues: true },
    default: {},
    placeholder: "Add Capability",
    displayOptions: {
      show: {
        authoringMode: ["visual"],
      },
    },
    options: [
      {
        displayName: "Capability",
        name: "values",
        values: capabilityBuilderValues,
      },
    ],
    description:
      "Visual capability registry. Validated with the same rules as JSON mode.",
  },
  {
    displayName: "Capability Name",
    name: "capabilityName",
    type: "options",
    default: "",
    typeOptions: {
      loadOptionsMethod: "getCapabilityNames",
      loadOptionsDependsOn: [
        "authoringMode",
        "capabilityDefinitionsJson",
        "capabilitiesBuilder",
      ],
    },
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "Technical capability name to execute. Choose from the registry or set via expression.",
  },
  {
    displayName: "Params Input Mode",
    name: "paramsInputMode",
    type: "options",
    default: "json",
    noDataExpression: true,
    options: [
      {
        name: "JSON",
        value: "json",
        description:
          "Pass capability parameters as a JSON object (best for AI Agent wiring).",
      },
      {
        name: "Mapped Fields",
        value: "mapper",
        description: "Fill typed fields generated from the selected capability schema.",
      },
    ],
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
  },
  {
    displayName: "Capability Params JSON",
    name: "capabilityParamsJson",
    type: "json",
    default: "{}",
    displayOptions: {
      show: {
        operation: ["call"],
        paramsInputMode: ["json"],
      },
    },
    description: `Business parameters passed by the AI agent for the selected capability. ${DEFAULT_MCP_CAPABILITY_PARAMS_EXAMPLE}`,
  },
  {
    displayName: "Capability Params",
    name: "capabilityParamsMapper",
    type: "resourceMapper",
    default: {
      mappingMode: "defineBelow",
      value: null,
    },
    noDataExpression: true,
    typeOptions: {
      resourceMapper: {
        resourceMapperMethod: "getCapabilityParamFields",
        mode: "add",
        fieldWords: {
          singular: "parameter",
          plural: "parameters",
        },
        addAllFields: true,
        multiKeyMatch: false,
        supportAutoMap: false,
        valuesLabel: "Capability Parameters",
      },
    },
    displayOptions: {
      show: {
        operation: ["call"],
        paramsInputMode: ["mapper"],
      },
    },
    description: "Typed parameters for the selected capability.",
  },
  {
    displayName: "Audit User ID",
    name: "auditUserId",
    type: "string",
    default: "anonymous",
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description: "User identifier recorded in the MCP audit log.",
  },
  {
    displayName: "Audit Session ID",
    name: "auditSessionId",
    type: "string",
    default: "",
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "Conversation session identifier for audit correlation. Leave empty to auto-generate.",
  },
  {
    displayName:
      "Leaving Audit Session ID empty generates a new session per call, breaking correlation across turns in a conversation.",
    name: "auditSessionNotice",
    type: "notice",
    default: "",
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
  },
  {
    displayName: "Include Audit In Output",
    name: "includeAuditInOutput",
    type: "boolean",
    default: true,
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "When enabled, attaches the sanitized audit object to the MCP response item. Disable when the item is forwarded directly to an AI Agent.",
  },
  {
    displayName: "Forbidden Capability Names JSON",
    name: "forbiddenCapabilityNamesJson",
    type: "json",
    default: "[]",
    description:
      "Capability names excluded from tools/list and rejected on tools/call for this agent profile. Wire from Plug AI Hub when available.",
  },
  {
    displayName: "Max Tool Calls Per Turn",
    name: "maxToolCallsPerTurn",
    type: "number",
    default: 0,
    typeOptions: {
      minValue: 0,
      maxValue: 20,
    },
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "Optional hard limit for tool calls in the current turn. Set 0 to disable. Wire from Plug AI Hub when available.",
  },
  {
    displayName: "Tool Call Count",
    name: "toolCallCount",
    type: "number",
    default: 0,
    typeOptions: {
      minValue: 0,
    },
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "Current tool-call ordinal for this turn (including this call). Track and increment in the workflow. When Max Tool Calls Per Turn is set and this is 0/empty, the node treats the call as #1 so the budget still applies.",
  },
  {
    displayName: "Show Advanced Options",
    name: "showAdvancedOptions",
    type: "boolean",
    default: false,
    noDataExpression: true,
    description: "Reveal optional agent/client overrides and protocol version fields.",
  },
  {
    displayName: "Agent ID",
    name: "agentId",
    type: "string",
    default: "",
    displayOptions: {
      show: {
        showAdvancedOptions: [true],
      },
    },
    description: "Optional agent override for capability execution.",
  },
  {
    displayName: "Client Token",
    name: "clientToken",
    type: "string",
    typeOptions: {
      password: true,
    },
    default: "",
    displayOptions: {
      show: {
        showAdvancedOptions: [true],
      },
    },
    description: "Optional client token override for capability execution.",
  },
  {
    displayName: "MCP Protocol Version",
    name: "mcpProtocolVersion",
    type: "string",
    default: MCP_PROTOCOL_VERSION,
    displayOptions: {
      show: {
        showAdvancedOptions: [true],
      },
    },
    description: "Declared MCP protocol version for external compatibility.",
  },
];

export const buildMcpServerNodeDescription = (
  options: McpServerDescriptionOptions,
): INodeTypeDescription => ({
  displayName: options.displayName,
  name: options.technicalName,
  icon: `file:${options.iconBaseName}.svg`,
  group: ["transform"],
  version: 1,
  subtitle: '={{$parameter["operation"]}}',
  description: options.description,
  defaults: {
    name: options.displayName,
  },
  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],
  credentials: [
    {
      name: options.credentialName,
      required: true,
    },
  ],
  properties: buildOperationProperties(),
});
