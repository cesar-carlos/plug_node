import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

const operationOptions = [
  {
    name: "Validate Context",
    value: "validateContext",
    description:
      "Checks login, agent access, and the configured client token end to end.",
  },
  {
    name: "Execute SQL",
    value: "executeSql",
    description: "Runs a single sql.execute command against the configured agent.",
  },
  {
    name: "Execute Batch",
    value: "executeBatch",
    description:
      "Runs a single sql.executeBatch command. This operation is REST-only in v1.",
  },
  {
    name: "Cancel SQL",
    value: "cancelSql",
    description: "Cancels a running SQL command by execution ID or request ID.",
  },
  {
    name: "Discover RPC",
    value: "discoverRpc",
    description: "Reads the agent RPC catalog with rpc.discover.",
  },
  {
    name: "Get Agent Profile",
    value: "getAgentProfile",
    description: "Reads the agent profile with the configured client token.",
  },
  {
    name: "Get Client Token Policy",
    value: "getClientTokenPolicy",
    description: "Reads the policy for the configured client token.",
  },
] as const;

const operationsWithInputMode = [
  "executeSql",
  "executeBatch",
  "cancelSql",
  "discoverRpc",
  "getAgentProfile",
  "getClientTokenPolicy",
];

const socketEligibleOperations = [
  "validateContext",
  "executeSql",
  "cancelSql",
  "discoverRpc",
  "getAgentProfile",
  "getClientTokenPolicy",
];

const buildResponseModeProperty = (supportsSocket: boolean): INodeProperties => ({
  displayName: "Response Mode",
  name: "responseMode",
  type: "options",
  default: "aggregatedJson",
  description: "Choose how the Plug response should be returned to n8n.",
  options: [
    {
      name: "Aggregated JSON",
      value: "aggregatedJson",
      description: "Returns rows as items when possible, otherwise a single JSON item.",
    },
    ...(supportsSocket
      ? [
          {
            name: "Chunk Items",
            value: "chunkItems",
            description:
              "Useful for socket SQL streams. Other operation and channel combinations fall back to aggregated output.",
          },
        ]
      : []),
    {
      name: "Raw JSON-RPC",
      value: "rawJsonRpc",
      description: "Returns the normalized RPC envelope for debugging or advanced flows.",
    },
  ],
  displayOptions: {
    show: {
      operation: operationsWithInputMode,
    },
  },
});

const buildIncludeMetadataProperty = (): INodeProperties => ({
  displayName: "Include Plug Metadata",
  name: "includePlugMetadata",
  type: "boolean",
  default: true,
  description:
    "Whether to include the __plug object with channel, agent, request, and socket metadata in the output.",
});

const commonAdvancedOptions = [
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
] as INodeProperties[];

const sqlAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "sqlOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: ["executeSql"],
      inputMode: ["guided"],
    },
  },
  options: [
    ...commonAdvancedOptions,
    {
      displayName: "Max Rows",
      name: "maxRows",
      type: "number",
      default: 0,
      description: "Optional max_rows value for sql.execute.",
    },
    {
      displayName: "Execution Mode",
      name: "executionMode",
      type: "options",
      default: "managed",
      description: "Choose how SQL should be handled by the agent.",
      options: [
        { name: "Managed", value: "managed" },
        { name: "Preserve", value: "preserve" },
      ],
    },
    {
      displayName: "Multi Result",
      name: "multiResult",
      type: "boolean",
      default: false,
      description: "Enable multi_result for drivers that support it.",
    },
    {
      displayName: "Page",
      name: "page",
      type: "number",
      default: 0,
      description: "Optional page number. Use together with Page Size.",
    },
    {
      displayName: "Page Size",
      name: "pageSize",
      type: "number",
      default: 0,
      description: "Optional page size. Use together with Page.",
    },
    {
      displayName: "Cursor",
      name: "cursor",
      type: "string",
      default: "",
      description: "Optional cursor for driver-managed pagination.",
    },
    {
      displayName: "Database",
      name: "database",
      type: "string",
      default: "",
      description: "Optional database or schema target for the command.",
    },
    {
      displayName: "Idempotency Key",
      name: "idempotencyKey",
      type: "string",
      default: "",
      description: "Optional idempotency key forwarded to the agent.",
    },
  ],
};

const batchAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "batchOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: ["executeBatch"],
      inputMode: ["guided"],
    },
  },
  options: [
    ...commonAdvancedOptions,
    {
      displayName: "Max Rows",
      name: "maxRows",
      type: "number",
      default: 0,
      description: "Optional max_rows value for sql.executeBatch.",
    },
    {
      displayName: "Transaction",
      name: "transaction",
      type: "boolean",
      default: false,
      description: "Runs the batch inside a transaction when supported by the agent.",
    },
    {
      displayName: "Database",
      name: "database",
      type: "string",
      default: "",
      description: "Optional database or schema target for the command.",
    },
    {
      displayName: "Idempotency Key",
      name: "idempotencyKey",
      type: "string",
      default: "",
      description: "Optional idempotency key forwarded to the agent.",
    },
  ],
};

const cancelAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "cancelOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: ["cancelSql"],
      inputMode: ["guided"],
    },
  },
  options: commonAdvancedOptions,
};

const discoverAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "discoverOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: ["discoverRpc"],
      inputMode: ["guided"],
    },
  },
  options: commonAdvancedOptions,
};

const profileAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "profileOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: ["getAgentProfile", "getClientTokenPolicy"],
      inputMode: ["guided"],
    },
  },
  options: commonAdvancedOptions,
};

const validateContextOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "validateContextOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: ["validateContext"],
    },
  },
  options: [
    {
      displayName: "Timeout (ms)",
      name: "timeoutMs",
      type: "number",
      default: 15000,
      description: "Optional timeout used for the validation request.",
    },
  ],
};

const sharedProperties = (supportsSocket: boolean): INodeProperties[] => {
  const properties: INodeProperties[] = [
    {
      displayName: "Operation",
      name: "operation",
      type: "options",
      default: "validateContext",
      options: [...operationOptions],
    },
  ];

  if (supportsSocket) {
    properties.push({
      displayName: "Channel",
      name: "channel",
      type: "options",
      default: "rest",
      description: "Choose whether the command should run over REST or the relay socket.",
      options: [
        { name: "REST", value: "rest" },
        { name: "Socket", value: "socket" },
      ],
      displayOptions: {
        show: {
          operation: [...socketEligibleOperations],
        },
      },
    });
  }

  properties.push(
    {
      displayName: "Input Mode",
      name: "inputMode",
      type: "options",
      default: "guided",
      description:
        "Guided mode keeps the node simple. Advanced mode lets you send the full JSON-RPC command.",
      options: [
        { name: "Guided", value: "guided" },
        { name: "Advanced", value: "advanced" },
      ],
      displayOptions: {
        show: {
          operation: operationsWithInputMode,
        },
      },
    },
    {
      ...buildResponseModeProperty(supportsSocket),
    },
    {
      ...buildIncludeMetadataProperty(),
    },
    {
      displayName: "SQL",
      name: "sql",
      type: "string",
      default: "",
      required: true,
      typeOptions: {
        rows: 8,
      },
      placeholder: "SELECT * FROM example_table WHERE id = :id",
      description: "The SQL statement to send with sql.execute.",
      displayOptions: {
        show: {
          operation: ["executeSql"],
          inputMode: ["guided"],
        },
      },
    },
    {
      displayName: "Named Params JSON",
      name: "namedParamsJson",
      type: "string",
      default: "",
      typeOptions: {
        rows: 4,
      },
      placeholder: '{"id": 1}',
      description:
        "Optional JSON object with named SQL parameters. Leave empty when not needed.",
      displayOptions: {
        show: {
          operation: ["executeSql"],
          inputMode: ["guided"],
        },
      },
    },
    {
      displayName: "Batch Commands JSON",
      name: "batchCommandsJson",
      type: "string",
      default: '[\n  {\n    "sql": "SELECT 1"\n  }\n]',
      required: true,
      typeOptions: {
        rows: 10,
      },
      description:
        "JSON array of sql.executeBatch command items. Each item can include sql, params, and execution_order.",
      displayOptions: {
        show: {
          operation: ["executeBatch"],
          inputMode: ["guided"],
        },
      },
    },
    {
      displayName: "Execution ID",
      name: "cancelExecutionId",
      type: "string",
      default: "",
      description: "Optional execution_id value for sql.cancel.",
      displayOptions: {
        show: {
          operation: ["cancelSql"],
          inputMode: ["guided"],
        },
      },
    },
    {
      displayName: "Request ID",
      name: "cancelRequestId",
      type: "string",
      default: "",
      description: "Optional request_id value for sql.cancel.",
      displayOptions: {
        show: {
          operation: ["cancelSql"],
          inputMode: ["guided"],
        },
      },
    },
    {
      displayName: "Discover Params JSON",
      name: "discoverParamsJson",
      type: "string",
      default: "",
      typeOptions: {
        rows: 4,
      },
      placeholder: '{"include_methods": true}',
      description:
        "Optional JSON object forwarded to rpc.discover. Leave empty to omit params.",
      displayOptions: {
        show: {
          operation: ["discoverRpc"],
          inputMode: ["guided"],
        },
      },
    },
    {
      displayName: "Raw JSON-RPC Command",
      name: "advancedCommandJson",
      type: "string",
      default: "",
      required: true,
      typeOptions: {
        rows: 12,
      },
      placeholder:
        '{\n  "jsonrpc": "2.0",\n  "method": "sql.execute",\n  "params": {\n    "sql": "SELECT 1"\n  }\n}',
      description:
        "Enter a single JSON-RPC command object. The credential client token is injected automatically where supported.",
      displayOptions: {
        show: {
          operation: operationsWithInputMode,
          inputMode: ["advanced"],
        },
      },
    },
    sqlAdvancedOptions,
    batchAdvancedOptions,
    cancelAdvancedOptions,
    discoverAdvancedOptions,
    profileAdvancedOptions,
    validateContextOptions,
  );

  return properties;
};

export interface PlugNodeDescriptionOptions {
  readonly supportsSocket: boolean;
  readonly displayName: string;
  readonly technicalName: string;
  readonly credentialName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

export const buildPlugClientNodeDescription = (
  options: PlugNodeDescriptionOptions,
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
  properties: sharedProperties(options.supportsSocket),
});
