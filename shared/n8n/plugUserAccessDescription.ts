import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

const agentStatusOptions = [
  {
    name: "All",
    value: "all",
  },
  {
    name: "Active",
    value: "active",
  },
  {
    name: "Inactive",
    value: "inactive",
  },
] as const;

const operationOptions = [
  {
    name: "List Agent Catalog",
    value: "listAgentCatalog",
    description: "Lists agents visible to the authenticated user.",
  },
  {
    name: "List Access Requests",
    value: "listManagedAccessRequests",
    description:
      "Lists client access requests for agents owned by the authenticated user.",
  },
  {
    name: "Approve Access Request",
    value: "approveAccessRequest",
    description: "Approves a pending client access request.",
  },
  {
    name: "Reject Access Request",
    value: "rejectAccessRequest",
    description: "Rejects a pending client access request.",
  },
  {
    name: "List Agent Clients",
    value: "listAgentClients",
    description: "Lists clients already approved for one owned agent.",
  },
  {
    name: "Revoke Agent Client Access",
    value: "revokeAgentClientAccess",
    description: "Revokes one client access from one owned agent.",
  },
] as const;

const buildCatalogPaginationProperties = (): INodeProperties[] => [
  {
    displayName: "Agent Status",
    name: "status",
    type: "options",
    default: "all",
    options: [...agentStatusOptions],
    displayOptions: {
      show: {
        operation: ["listAgentCatalog"],
      },
    },
  },
  {
    displayName: "Search",
    name: "search",
    type: "string",
    default: "",
    description: "Optional search text forwarded to Plug.",
    displayOptions: {
      show: {
        operation: ["listAgentCatalog"],
      },
    },
  },
  {
    displayName: "Return All",
    name: "returnAll",
    type: "boolean",
    default: false,
    description:
      "Whether to request every page from the Plug catalog before returning items.",
    displayOptions: {
      show: {
        operation: ["listAgentCatalog"],
      },
    },
  },
  {
    displayName: "Page",
    name: "page",
    type: "number",
    default: 1,
    description: "Catalog page to request from Plug.",
    displayOptions: {
      show: {
        operation: ["listAgentCatalog"],
        returnAll: [false],
      },
    },
  },
  {
    displayName: "Page Size",
    name: "pageSize",
    type: "number",
    default: 50,
    description: "Catalog page size to request from Plug.",
    displayOptions: {
      show: {
        operation: ["listAgentCatalog"],
        returnAll: [false],
      },
    },
  },
];

export interface PlugUserAccessNodeDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly credentialName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

export const buildPlugUserAccessNodeDescription = (
  options: PlugUserAccessNodeDescriptionOptions,
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
  usableAsTool: true,
  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],
  credentials: [
    {
      name: options.credentialName,
      required: true,
    },
  ],
  properties: [
    {
      displayName: "Operation",
      name: "operation",
      type: "options",
      default: "listAgentCatalog",
      options: [...operationOptions],
    },
    {
      displayName: "Include Plug Metadata",
      name: "includePlugMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plug object with operation and pagination metadata.",
    },
    ...buildCatalogPaginationProperties(),
    {
      displayName: "Request ID",
      name: "requestId",
      type: "string",
      default: "",
      required: true,
      description: "The client access request identifier.",
      displayOptions: {
        show: {
          operation: ["approveAccessRequest", "rejectAccessRequest"],
        },
      },
    },
    {
      displayName: "Agent ID",
      name: "agentId",
      type: "string",
      default: "",
      required: true,
      description: "The Plug agent identifier.",
      displayOptions: {
        show: {
          operation: ["listAgentClients", "revokeAgentClientAccess"],
        },
      },
    },
    {
      displayName: "Client ID",
      name: "clientId",
      type: "string",
      default: "",
      required: true,
      description: "The Plug client identifier approved for this agent.",
      displayOptions: {
        show: {
          operation: ["revokeAgentClientAccess"],
        },
      },
    },
  ],
});
