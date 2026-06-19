import type { INodeProperties } from "n8n-workflow";

import {
  plugSqlBulkInsertOperation,
  plugSqlCancelOperation,
  plugSqlDiscoverRpcOperation,
  plugSqlExecuteBatchOperation,
  plugSqlExecuteSqlOperation,
  plugSqlGetAgentProfileOperation,
  plugSqlGetClientTokenPolicyOperation,
  plugSqlValidateContextOperation,
  plugSqlCommonAdvancedOptions,
} from "./plugSqlDescriptionCommon";

export const plugSqlAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "sqlOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlExecuteSqlOperation],
      inputMode: ["guided"],
    },
  },
  options: [
    ...plugSqlCommonAdvancedOptions,
    {
      displayName: "Max Rows",
      name: "maxRows",
      type: "number",
      default: 0,
      description:
        "Maximum rows to ask the agent to return. Use 0 to leave the agent default unchanged.",
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
      displayName: "Prefer DB Streaming",
      name: "preferDbStreaming",
      type: "boolean",
      default: false,
      description:
        "Sets options.prefer_db_streaming for eligible SELECT statements. Use with Channel = Socket for large reads.",
    },
    {
      displayName: "Auto Performance Hints",
      name: "autoPerformanceHints",
      type: "boolean",
      default: true,
      description:
        "When enabled, suggests prefer_db_streaming on Socket for large eligible SELECT statements unless Prefer DB Streaming is set explicitly.",
    },
    {
      displayName: "Page",
      name: "page",
      type: "number",
      default: 0,
      description: "Page number for page-based pagination. Use together with Page Size.",
    },
    {
      displayName: "Page Size",
      name: "pageSize",
      type: "number",
      default: 0,
      description: "Rows per page for page-based pagination. Use together with Page.",
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
    {
      displayName: "Require WHERE for UPDATE/DELETE",
      name: "requireWhereForUpdateDelete",
      type: "boolean",
      default: true,
      description:
        "Whether to block UPDATE and DELETE statements that do not include a WHERE clause before sending them to Plug.",
    },
  ],
};

export const plugSqlBatchAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "batchOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlExecuteBatchOperation],
      inputMode: ["guided"],
    },
  },
  options: [
    ...plugSqlCommonAdvancedOptions,
    {
      displayName: "Max Rows",
      name: "maxRows",
      type: "number",
      default: 0,
      description:
        "Maximum rows to ask the agent to return from batch commands. Use 0 to leave the agent default unchanged.",
    },
    {
      displayName: "Transaction",
      name: "transaction",
      type: "boolean",
      default: false,
      description: "Runs the batch inside a transaction when supported by the agent.",
    },
    {
      displayName: "Max Parallel Read-Only Items",
      name: "maxParallelReadOnlyBatchItems",
      type: "number",
      default: 0,
      description:
        "Optional max_parallel_read_only_batch_items for the batch. Use 0 to omit.",
    },
    {
      displayName: "Auto Performance Hints",
      name: "autoPerformanceHints",
      type: "boolean",
      default: true,
      description:
        "When enabled, suggests max_parallel_read_only_batch_items for all-read-only batches unless Max Parallel Read-Only Items is set explicitly.",
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
    {
      displayName: "Require WHERE for UPDATE/DELETE",
      name: "requireWhereForUpdateDelete",
      type: "boolean",
      default: true,
      description:
        "Whether to block UPDATE and DELETE statements in the batch that do not include a WHERE clause before sending them to Plug.",
    },
    {
      displayName: "Coalesce Input Items",
      name: "coalesceInputItems",
      type: "boolean",
      default: false,
      description:
        "Merge Batch Commands JSON from all input items into one sql.executeBatch call. Additional Options must match on every item. The node returns one output item.",
    },
  ],
};

export const plugSqlBulkInsertAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "bulkInsertOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlBulkInsertOperation],
      inputMode: ["guided"],
    },
  },
  options: [...plugSqlCommonAdvancedOptions],
};

export const plugSqlCancelAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "cancelOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlCancelOperation],
      inputMode: ["guided"],
    },
  },
  options: plugSqlCommonAdvancedOptions,
};

export const plugSqlDiscoverAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "discoverOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlDiscoverRpcOperation],
      inputMode: ["guided"],
    },
  },
  options: plugSqlCommonAdvancedOptions,
};

export const plugSqlProfileAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "profileOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlGetAgentProfileOperation, plugSqlGetClientTokenPolicyOperation],
      inputMode: ["guided"],
    },
  },
  options: plugSqlCommonAdvancedOptions,
};

export const plugSqlValidateContextAdvancedOptions: INodeProperties = {
  displayName: "Additional Options",
  name: "validateContextOptions",
  type: "collection",
  placeholder: "Add option",
  default: {},
  displayOptions: {
    show: {
      operation: [plugSqlValidateContextOperation],
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

export const plugSqlSocketAdvancedOptions: INodeProperties = {
  displayName: "Socket Options",
  name: "socketOptions",
  type: "collection",
  placeholder: "Add socket option",
  default: {},
  displayOptions: {
    show: {
      channel: ["socket"],
    },
  },
  options: [
    {
      displayName: "Max Buffered Rows",
      name: "maxBufferedRows",
      type: "number",
      default: 50000,
      description:
        "Maximum rows the node buffers locally while collecting socket stream output.",
    },
    {
      displayName: "Max Buffered Bytes",
      name: "maxBufferedBytes",
      type: "number",
      default: 8388608,
      description:
        "Maximum approximate JSON bytes the node buffers locally while collecting socket stream output.",
    },
    {
      displayName: "Max Buffered Chunks",
      name: "maxBufferedChunks",
      type: "number",
      default: 512,
      description:
        "Maximum socket stream chunks the node buffers locally before failing clearly.",
    },
    {
      displayName: "Stream Pull Window Size",
      name: "streamPullWindowSize",
      type: "number",
      default: 0,
      typeOptions: {
        minValue: 0,
        maxValue: 1000,
      },
      description:
        "Socket stream chunks requested per pull window. Use 0 to apply the agent recommendedStreamPullWindowSize (clamped to 1000).",
    },
    {
      displayName: "Relay Fast Path",
      name: "fastPath",
      type: "boolean",
      default: false,
      description:
        "Opt-in relay unary fast-path: skip relay:rpc.accepted on the happy path and route responses by JSON-RPC body id.",
    },
    {
      displayName: "Request Server Timings",
      name: "requestServerTimings",
      type: "boolean",
      default: false,
      description:
        "Include server-side phase timings in socket relay responses when the hub supports requestServerTimings.",
    },
  ],
};
