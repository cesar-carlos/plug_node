import type { INodeProperties } from "n8n-workflow";

import {
  plugSqlBulkInsertOperation,
  plugSqlCancelOperation,
  plugSqlDiscoverRpcOperation,
  plugSqlExecuteBatchOperation,
  plugSqlExecuteSqlOperation,
  plugSqlOperationsWithInputMode,
} from "./plugSqlDescriptionCommon";

export const buildPlugSqlGuidedOperationFields = (): INodeProperties[] => [
  {
    displayName: "SQL",
    name: "sql",
    type: "string",
    default: "",
    required: true,
    typeOptions: {
      rows: 8,
    },
    placeholder: "SELECT TOP 10 *\nFROM Cliente\nWHERE CodCliente = :codCliente;",
    description:
      "SQL to execute. Replace template markers before running and use :name placeholders with Named Params JSON for dynamic values.",
    displayOptions: {
      show: {
        operation: [plugSqlExecuteSqlOperation],
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
    placeholder: '{\n  "codCliente": "{{$json.CodCliente}}"\n}',
    description:
      "Optional JSON object for :name SQL parameters. Values can use n8n expressions such as {{$json.id}}.",
    displayOptions: {
      show: {
        operation: [plugSqlExecuteSqlOperation],
        inputMode: ["guided"],
      },
    },
  },
  {
    displayName: "Batch Commands JSON",
    name: "batchCommandsJson",
    type: "string",
    default:
      '[\n  { "sql": "SELECT TOP 1 * FROM Cliente" },\n  { "sql": "SELECT TOP 1 * FROM Vendedor" }\n]',
    required: true,
    typeOptions: {
      rows: 10,
    },
    description:
      "JSON array of batch SQL items. Replace template markers; each item can include sql, params, and execution_order.",
    displayOptions: {
      show: {
        operation: [plugSqlExecuteBatchOperation],
        inputMode: ["guided"],
      },
    },
  },
  {
    displayName: "Table",
    name: "bulkInsertTable",
    type: "string",
    default: "",
    required: true,
    description: "Target table name for sql.bulkInsert (for example dbo.MyTable).",
    displayOptions: {
      show: {
        operation: [plugSqlBulkInsertOperation],
        inputMode: ["guided"],
      },
    },
  },
  {
    displayName: "Columns JSON",
    name: "bulkInsertColumnsJson",
    type: "string",
    default:
      '[\n  { "name": "id", "type": "i64" },\n  { "name": "name", "type": "text" }\n]',
    required: true,
    typeOptions: {
      rows: 6,
    },
    description:
      "JSON array of column definitions (name, type, optional nullable, max_len).",
    displayOptions: {
      show: {
        operation: [plugSqlBulkInsertOperation],
        inputMode: ["guided"],
      },
    },
  },
  {
    displayName: "Rows JSON",
    name: "bulkInsertRowsJson",
    type: "string",
    default: '[\n  [1, "example"]\n]',
    required: true,
    typeOptions: {
      rows: 6,
    },
    description:
      "JSON array of row arrays. Each row length must match the columns array.",
    displayOptions: {
      show: {
        operation: [plugSqlBulkInsertOperation],
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
        operation: [plugSqlCancelOperation],
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
        operation: [plugSqlCancelOperation],
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
        operation: [plugSqlDiscoverRpcOperation],
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
      "Enter a single JSON-RPC command object. The resolved client token from the node override or credential default is injected automatically where supported.",
    displayOptions: {
      show: {
        operation: plugSqlOperationsWithInputMode,
        inputMode: ["advanced"],
      },
    },
  },
];
