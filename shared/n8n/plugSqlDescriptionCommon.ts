import type { INodeProperties } from "n8n-workflow";

export const plugSqlValidateContextOperation = "validateContext" as const;
export const plugSqlExecuteSqlOperation = "executeSql" as const;
export const plugSqlExecuteBatchOperation = "executeBatch" as const;
export const plugSqlBulkInsertOperation = "bulkInsertSql" as const;
export const plugSqlCancelOperation = "cancelSql" as const;
export const plugSqlDiscoverRpcOperation = "discoverRpc" as const;
export const plugSqlGetAgentProfileOperation = "getAgentProfile" as const;
export const plugSqlGetClientTokenPolicyOperation = "getClientTokenPolicy" as const;

export const plugSqlOperationOptions = [
  {
    name: "Validate Context",
    value: plugSqlValidateContextOperation,
    description: "Checks login, agent access, and the resolved client token end to end.",
  },
  {
    name: "Execute SQL",
    value: plugSqlExecuteSqlOperation,
    description: "Runs a single sql.execute command against the resolved agent.",
  },
  {
    name: "Execute Batch",
    value: plugSqlExecuteBatchOperation,
    description: "Runs a single sql.executeBatch command.",
  },
  {
    name: "Bulk Insert SQL",
    value: plugSqlBulkInsertOperation,
    description: "Runs sql.bulkInsert with a table, column schema, and row matrix.",
  },
  {
    name: "Cancel SQL",
    value: plugSqlCancelOperation,
    description: "Cancels a running SQL command by execution ID or request ID.",
  },
  {
    name: "Discover RPC",
    value: plugSqlDiscoverRpcOperation,
    description: "Reads the agent RPC catalog with rpc.discover.",
  },
  {
    name: "Get Agent Profile",
    value: plugSqlGetAgentProfileOperation,
    description: "Reads the agent profile with the resolved client token.",
  },
  {
    name: "Get Client Token Policy",
    value: plugSqlGetClientTokenPolicyOperation,
    description: "Reads the policy for the resolved client token.",
  },
] as const;

export const plugSqlOperationsWithInputMode = [
  plugSqlExecuteSqlOperation,
  plugSqlExecuteBatchOperation,
  plugSqlBulkInsertOperation,
  plugSqlCancelOperation,
  plugSqlDiscoverRpcOperation,
  plugSqlGetAgentProfileOperation,
  plugSqlGetClientTokenPolicyOperation,
];

export const plugSqlSocketEligibleOperationsV1 = [
  plugSqlValidateContextOperation,
  plugSqlExecuteSqlOperation,
  plugSqlCancelOperation,
  plugSqlDiscoverRpcOperation,
  plugSqlGetAgentProfileOperation,
  plugSqlGetClientTokenPolicyOperation,
];

export const plugSqlSocketEligibleOperationsV2 = [
  ...plugSqlSocketEligibleOperationsV1,
  plugSqlExecuteBatchOperation,
  plugSqlBulkInsertOperation,
];

export const buildPlugSqlResponseModeProperty = (
  supportsSocket: boolean,
): INodeProperties => ({
  displayName: "Response Mode",
  name: "responseMode",
  type: "options",
  default: "aggregatedJson",
  description:
    "Choose the shape of the node output. Use Aggregated JSON for most workflows and Chunk Items for large socket streams.",
  options: [
    {
      name: "Aggregated JSON",
      value: "aggregatedJson",
      description:
        "Returns SQL rows as n8n items when possible, otherwise one JSON item.",
    },
    ...(supportsSocket
      ? [
          {
            name: "Chunk Items",
            value: "chunkItems",
            description:
              "Returns socket stream chunks as items for large result sets. Other combinations fall back to aggregated output.",
          },
        ]
      : []),
    {
      name: "Raw JSON-RPC",
      value: "rawJsonRpc",
      description:
        "Returns the normalized RPC envelope for debugging or advanced flows. May include sensitive SQL results, tokens, or internal metadata — avoid in production logs or shared workflows.",
    },
  ],
  displayOptions: {
    show: {
      operation: plugSqlOperationsWithInputMode,
    },
  },
});

export const buildPlugSqlIncludeMetadataProperty = (): INodeProperties => ({
  displayName: "Include Plug Metadata",
  name: "includePlugMetadata",
  type: "boolean",
  default: true,
  description:
    "Whether to include the __plug object with channel, agent, request, and socket metadata in the output.",
});

export const plugSqlCommonAdvancedOptions = [
  {
    displayName: "Timeout (ms)",
    name: "timeoutMs",
    type: "number",
    default: 15000,
    description:
      "Sets both the bridge wait timeout and the command timeout when the operation supports it.",
  },
  {
    displayName: "API Version",
    name: "apiVersion",
    type: "string",
    default: "2.8",
    description:
      "Overrides the default Plug api_version value used for the JSON-RPC command.",
  },
  {
    displayName: "RPC Meta JSON",
    name: "metaJson",
    type: "string",
    default: "",
    typeOptions: {
      rows: 4,
    },
    description:
      "Optional JSON object merged into command.meta. Leave empty to use the default.",
  },
  {
    displayName: "Request Server Timings",
    name: "requestServerTimings",
    type: "boolean",
    default: false,
    description:
      "When enabled, asks Plug to include server-side phase timings in the response (REST, agents:command, or relay).",
  },
] as INodeProperties[];
