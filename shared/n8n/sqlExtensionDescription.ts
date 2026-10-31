import type { INodeProperties } from "n8n-workflow";
export const buildSqlExtensionProperties = (): INodeProperties[] => [
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    default: "sql.describeSource",
    options: [
      { name: "Get Agent Health", value: "agent.getHealth", action: "Get agent health" },
      {
        name: "Describe Source",
        value: "sql.describeSource",
        action: "Describe source identity",
      },
      {
        name: "Describe Schema",
        value: "sql.describeSchema",
        action: "Describe source schema",
      },
      {
        name: "Execute Operation",
        value: "sql.operation.execute",
        action: "Execute a durable SQL operation",
      },
      {
        name: "Get Operation",
        value: "sql.operation.get",
        action: "Get a durable SQL operation",
      },
      {
        name: "Cancel Operation",
        value: "sql.operation.cancel",
        action: "Cancel a durable SQL operation",
      },
    ],
  },
  {
    displayName: "Channel",
    name: "actionChannel",
    type: "options",
    default: "rest",
    options: [
      { name: "REST", value: "rest" },
      { name: "Socket", value: "socket" },
      { name: "Relay", value: "relay" },
    ],
  },
  {
    displayName:
      "Requires current negotiated extensions on Hub and agent. Discovery does not enable execution. Persist operationId, fingerprint and source identity before dispatch. Cancellation acceptance is not rollback; never replay unknown outcomes.",
    name: "extensionNotice",
    type: "notice",
    default: "",
  },
  {
    displayName: "Parameters",
    name: "extensionParams",
    displayOptions: { hide: { operation: ["agent.getHealth"] } },
    type: "json",
    default: '{"contractVersion":1,"database":""}',
    description:
      "Method-specific contract parameters, without credentials. Execute requires a bounded typed plan; get/cancel require the original operationId, fingerprint, sourcePhysicalId and database.",
  },
];
