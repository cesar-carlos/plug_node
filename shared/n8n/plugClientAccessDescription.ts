import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

const clientAgentStatusOptions = [
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

const accessRequestStatusOptions = [
  {
    name: "All",
    value: "all",
  },
  {
    name: "Pending",
    value: "pending",
  },
  {
    name: "Approved",
    value: "approved",
  },
  {
    name: "Rejected",
    value: "rejected",
  },
  {
    name: "Expired",
    value: "expired",
  },
  {
    name: "Revoked",
    value: "revoked",
  },
] as const;

const operationOptions = [
  {
    name: "List Client Agents",
    value: "listClientAgents",
    description: "Lists approved agents for the authenticated client.",
  },
  {
    name: "Get Client Agent",
    value: "getClientAgent",
    description: "Gets one approved agent for the authenticated client.",
  },
  {
    name: "List Access Requests",
    value: "listAccessRequests",
    description: "Lists client access requests and their statuses.",
  },
  {
    name: "Request Agent Access",
    value: "requestAgentAccess",
    description: "Requests access to one or more agents.",
  },
  {
    name: "Revoke Agent Access",
    value: "revokeAgentAccess",
    description: "Removes approved access for one or more agents.",
  },
  {
    name: "Get Client Token",
    value: "getClientToken",
    description: "Reads the stored bearer token for one approved agent.",
  },
  {
    name: "Set Client Token",
    value: "setClientToken",
    description: "Stores or clears the bearer token for one approved agent.",
  },
] as const;

const detailOperations = ["getClientAgent", "getClientToken", "setClientToken"] as const;

const buildPaginationProperties = (
  operations: readonly string[],
  statusOptions: readonly { readonly name: string; readonly value: string }[],
  statusName: string,
): INodeProperties[] => [
  {
    displayName: statusName,
    name: "status",
    type: "options",
    default: "all",
    options: [...statusOptions],
    displayOptions: {
      show: {
        operation: [...operations],
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
        operation: [...operations],
      },
    },
  },
  {
    displayName: "Return All",
    name: "returnAll",
    type: "boolean",
    default: false,
    description: "Whether to request all pages from Plug before returning items.",
    displayOptions: {
      show: {
        operation: [...operations],
      },
    },
  },
  {
    displayName: "Page",
    name: "page",
    type: "number",
    default: 1,
    description: "Page number to request from Plug.",
    displayOptions: {
      show: {
        operation: [...operations],
        returnAll: [false],
      },
    },
  },
  {
    displayName: "Page Size",
    name: "pageSize",
    type: "number",
    default: 50,
    description: "Page size to request from Plug.",
    displayOptions: {
      show: {
        operation: [...operations],
        returnAll: [false],
      },
    },
  },
];

const buildAgentIdListProperty = (
  name: string,
  displayName: string,
  description: string,
  operations: readonly string[],
  extraDisplayOptions?: Record<string, string[]>,
): INodeProperties => ({
  displayName,
  name,
  type: "fixedCollection",
  typeOptions: {
    multipleValues: true,
  },
  default: {
    values: [
      {
        agentId: "",
      },
    ],
  },
  description,
  options: [
    {
      name: "values",
      displayName: "Agent IDs",
      values: [
        {
          displayName: "Agent ID",
          name: "agentId",
          type: "string",
          default: "",
          description: "The Plug agent identifier.",
        },
      ],
    },
  ],
  displayOptions: {
    show: {
      operation: [...operations],
      ...(extraDisplayOptions ?? {}),
    },
  },
});

export interface PlugClientAccessNodeDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly credentialName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

export const buildPlugClientAccessProperties = (): INodeProperties[] => [
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    default: "listClientAgents",
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
  ...buildPaginationProperties(
    ["listClientAgents"],
    clientAgentStatusOptions,
    "Agent Status",
  ),
  {
    displayName: "Refresh Live Agent State",
    name: "refresh",
    type: "boolean",
    default: false,
    description:
      "Whether Plug should refresh online agents in the current page from the live socket profile before responding.",
    displayOptions: {
      show: {
        operation: ["listClientAgents"],
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
        operation: [...detailOperations],
      },
    },
  },
  {
    displayName: "Agent ID",
    name: "revokeAgentId",
    type: "string",
    default: "",
    required: true,
    description: "The Plug agent identifier.",
    displayOptions: {
      show: {
        operation: ["revokeAgentAccess"],
        revokeMode: ["single"],
      },
    },
  },
  ...buildPaginationProperties(
    ["listAccessRequests"],
    accessRequestStatusOptions,
    "Request Status",
  ),
  buildAgentIdListProperty(
    "agentIds",
    "Agent IDs",
    "One or more Plug agent IDs to request access for.",
    ["requestAgentAccess"],
  ),
  {
    displayName: "Revoke Mode",
    name: "revokeMode",
    type: "options",
    default: "single",
    options: [
      {
        name: "Single Agent",
        value: "single",
      },
      {
        name: "Batch",
        value: "batch",
      },
    ],
    displayOptions: {
      show: {
        operation: ["revokeAgentAccess"],
      },
    },
  },
  buildAgentIdListProperty(
    "revokeAgentIds",
    "Agent IDs",
    "One or more Plug agent IDs to revoke.",
    ["revokeAgentAccess"],
    {
      revokeMode: ["batch"],
    },
  ),
  {
    displayName: "Client Token",
    name: "clientToken",
    type: "string",
    default: "",
    required: true,
    typeOptions: {
      password: true,
    },
    description: "The bearer token stored for this client and agent pair.",
    displayOptions: {
      show: {
        operation: ["setClientToken"],
        clearStoredClientToken: [false],
      },
    },
  },
  {
    displayName: "Clear Stored Client Token",
    name: "clearStoredClientToken",
    type: "boolean",
    default: false,
    description: "Whether to clear the stored client token instead of replacing it.",
    displayOptions: {
      show: {
        operation: ["setClientToken"],
      },
    },
  },
];

export const buildPlugClientAccessNodeDescription = (
  options: PlugClientAccessNodeDescriptionOptions,
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
  properties: buildPlugClientAccessProperties(),
});
