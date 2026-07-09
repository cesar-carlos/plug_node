import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import { MCP_PROTOCOL_VERSION } from "../mcp/contracts";

export interface McpServerDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly credentialName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

const capabilityDefinitionsProperty: INodeProperties = {
  displayName: "Capability Definitions JSON",
  name: "capabilityDefinitionsJson",
  type: "json",
  default: "[]",
  required: true,
  description:
    "Array of capability definitions with semantic contract, governance, and SQL/Tools execution config. V1 uses inline definitions (not child-node wiring).",
};

const buildOperationProperties = (): INodeProperties[] => [
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    default: "list",
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
    ],
  },
  {
    displayName: "Capability Name",
    name: "capabilityName",
    type: "string",
    default: "",
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description: "Technical capability name to execute, for example consultar_cliente.",
  },
  {
    displayName: "Capability Params JSON",
    name: "capabilityParamsJson",
    type: "json",
    default: "{}",
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "Business parameters passed by the AI agent for the selected capability.",
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
    displayOptions: {
      show: {
        operation: ["call"],
      },
    },
    description:
      "Current tool-call count for this turn (including this call). Used with Max Tool Calls Per Turn.",
  },
  capabilityDefinitionsProperty,
  {
    displayName: "Agent ID",
    name: "agentId",
    type: "string",
    default: "",
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
    description: "Optional client token override for capability execution.",
  },
  {
    displayName: "MCP Protocol Version",
    name: "mcpProtocolVersion",
    type: "string",
    default: MCP_PROTOCOL_VERSION,
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
