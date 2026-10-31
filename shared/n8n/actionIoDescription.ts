import type { INodeProperties } from "n8n-workflow";

export const buildActionIoProperties = (): INodeProperties[] => {
  const property = (
    displayName: string,
    name: string,
    operations: string[],
    type: "string" | "number" | "boolean" = "string",
    value: string | number | boolean = "",
  ): INodeProperties => ({
    displayName,
    name,
    type,
    default: value,
    displayOptions: { show: { operation: operations } },
    ...(type === "number"
      ? {
          typeOptions: {
            minValue: 0,
            maxValue: Number.MAX_SAFE_INTEGER,
            numberPrecision: 0,
          },
        }
      : {}),
  });
  return [
    {
      displayName: "Operation",
      name: "operation",
      type: "options",
      noDataExpression: true,
      default: "validateRun",
      options: [
        ["Cancel", "cancel"],
        ["Close Input", "closeInput"],
        ["Find Execution", "findExecution"],
        ["Get Execution", "getExecution"],
        ["Get Input Status", "getInputStatus"],
        ["List Available Actions", "listAvailable"],
        ["Read I/O", "readIo"],
        ["Run", "run"],
        ["Send Input", "sendInput"],
        ["Validate Run", "validateRun"],
      ].map(([name, value]) => ({ name, value, action: `${name} a saved agent action` })),
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
        "No automatic replay. Persist keys, message IDs and checkpoints before sending. Disable Retry On Fail for this node. Accepted and written do not mean program consumption or success.",
      name: "actionNotice",
      type: "notice",
      default: "",
    },
    property("Action ID", "actionId", ["run", "validateRun", "findExecution"]),
    {
      ...property("Page Size", "catalogPageSize", ["listAvailable"], "number", 20),
      typeOptions: { minValue: 1, maxValue: 50, numberPrecision: 0 },
    },
    {
      ...property("Cursor", "catalogCursor", ["listAvailable"]),
      description:
        "Leave empty for the first page. Pass the previous next_cursor to continue with the same agent and credential. A null next_cursor ends the listing.",
    },
    property("Idempotency Key", "actionKey", ["run", "validateRun", "findExecution"]),
    property("Trigger ID", "actionTrigger", ["run", "validateRun"]),
    property("Execution ID", "actionExecutionId", [
      "sendInput",
      "closeInput",
      "getInputStatus",
      "readIo",
      "getExecution",
      "cancel",
    ]),
    property("Message ID", "actionMessageId", [
      "sendInput",
      "closeInput",
      "getInputStatus",
    ]),
    property(
      "Input Sequence",
      "actionSequence",
      ["sendInput", "closeInput"],
      "number",
      0,
    ),
    property(
      "Include Initial Input",
      "actionInitial",
      ["run", "validateRun"],
      "boolean",
      false,
    ),
    property(
      "Close Input After Initial Input",
      "actionClose",
      ["run", "validateRun"],
      "boolean",
      false,
    ),
    {
      displayName: "Input Format",
      name: "actionInputFormat",
      type: "options",
      default: "base64",
      options: [
        { name: "Base64", value: "base64" },
        { name: "n8n Binary", value: "binary" },
      ],
      displayOptions: { show: { operation: ["run", "validateRun", "sendInput"] } },
    },
    property("Input Base64", "actionBase64", ["run", "validateRun", "sendInput"]),
    property(
      "Input Binary Field",
      "actionBinaryField",
      ["run", "validateRun", "sendInput"],
      "string",
      "data",
    ),
    property("After Sequence", "actionAfterSequence", ["readIo"], "number", 0),
    property(
      "Expected Stdout Byte Offset",
      "actionStdoutOffset",
      ["readIo"],
      "number",
      0,
    ),
    property(
      "Expected Stderr Byte Offset",
      "actionStderrOffset",
      ["readIo"],
      "number",
      0,
    ),
    {
      ...property("Max Read Bytes", "actionMaxBytes", ["readIo"], "number", 262144),
      typeOptions: { minValue: 65536, maxValue: 262144, numberPrecision: 0 },
    },
    {
      ...property("Wait (ms)", "actionWaitMs", ["readIo"], "number", 20000),
      typeOptions: { minValue: 0, maxValue: 20000, numberPrecision: 0 },
    },
  ];
};
