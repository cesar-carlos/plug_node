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
        ["Read Complete Output", "readAll"],
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
    {
      displayName: "Choose Action",
      name: "actionSelection",
      type: "options",
      noDataExpression: true,
      default: "manual",
      options: [
        { name: "Enter ID or Expression", value: "manual" },
        { name: "Select From Authorized Catalog", value: "catalog" },
      ],
      displayOptions: { show: { operation: ["run", "validateRun", "findExecution"] } },
      description:
        "The catalog only lists permitted actions. For recovery, keep the original Action ID even if it no longer appears in the catalog.",
    },
    {
      ...property("Action ID", "actionId", ["run", "validateRun", "findExecution"]),
      displayOptions: {
        show: { operation: ["run", "validateRun", "findExecution"] },
        hide: { actionSelection: ["catalog"] },
      },
      description:
        "Saved action identifier. Existing IDs and expressions remain supported.",
    },
    {
      displayName: "Authorized Action",
      name: "actionCatalog",
      typeOptions: { loadOptionsDependsOn: ["agentCredentialSource", "actionChannel"] },
      type: "resourceLocator",
      default: { mode: "list", value: "" },
      modes: [
        {
          displayName: "From Catalog",
          name: "list",
          type: "list",
          typeOptions: { searchListMethod: "getAuthorizedActions", searchable: false },
        },
      ],
      displayOptions: {
        show: {
          operation: ["run", "validateRun", "findExecution"],
          actionSelection: ["catalog"],
        },
      },
      description:
        "Loads one authorized page at a time using the selected credentials and channel. Selecting an action never starts it. Validate Run still checks current permissions.",
    },
    {
      ...property("Page Size", "catalogPageSize", ["listAvailable"], "number", 20),
      typeOptions: { minValue: 1, maxValue: 50, numberPrecision: 0 },
    },
    {
      ...property("Cursor", "catalogCursor", ["listAvailable"]),
      description:
        "Leave empty for the first page. Pass the previous next_cursor to continue with the same agent and credential. A null next_cursor ends the listing.",
    },
    {
      ...property("Idempotency Key", "actionKey", [
        "run",
        "validateRun",
        "findExecution",
      ]),
      description:
        "Use the same saved key for Validate Run, Run and recovery with Find Execution. Generate a new key only for a new intended process; do not replace it after losing a response.",
    },
    property("Trigger ID", "actionTrigger", ["run", "validateRun"]),
    property("Execution ID", "actionExecutionId", [
      "sendInput",
      "closeInput",
      "getInputStatus",
      "readIo",
      "readAll",
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
    ...[true, false].flatMap((initial): INodeProperties[] => {
      const operations = initial ? ["run", "validateRun"] : ["sendInput"];
      const show = {
        operation: operations,
        ...(initial ? { actionInitial: [true] } : {}),
      };
      return [
        {
          displayName: "Input Format",
          name: "actionInputFormat",
          type: "options",
          default: "base64",
          options: [
            { name: "Text UTF-8", value: "text" },
            { name: "Base64", value: "base64" },
            { name: "n8n Binary", value: "binary" },
          ],
          displayOptions: { show },
        },
        {
          ...property("Input Base64", "actionBase64", operations),
          description:
            "Already encoded base64, forwarded without re-encoding. Maximum 64 KiB decoded; no newline is added.",
          displayOptions: { show: { ...show, actionInputFormat: ["base64"] } },
        },
        {
          ...property("Input Text", "actionText", operations),
          typeOptions: { rows: 4 },
          description:
            "Plain text encoded once as UTF-8. Maximum 64 KiB in bytes, including accents and emoji. No newline is added; include one explicitly if the program requires it. Empty text is not EOF.",
          displayOptions: { show: { ...show, actionInputFormat: ["text"] } },
        },
        {
          ...property(
            "Input Binary Field",
            "actionBinaryField",
            operations,
            "string",
            "data",
          ),
          displayOptions: { show: { ...show, actionInputFormat: ["binary"] } },
        },
      ];
    }),
    {
      displayName:
        "Process exit is not complete output. Continue reading until the completed event is consumed. Require its output_complete to be true and no failure. Page terminal/output_complete flags describe agent state, not delivery of every page. Resume from the last consumed next_sequence and next_offsets after a disconnect; do not run the process again.",
      name: "actionReadNotice",
      type: "notice",
      default: "",
      displayOptions: { show: { operation: ["readIo", "readAll"] } },
    },
    {
      ...property(
        "After Sequence",
        "actionAfterSequence",
        ["readIo", "readAll"],
        "number",
        0,
      ),
      description:
        "Last consumed event sequence. Persist it with both byte offsets; use zero only for the first read.",
    },
    property(
      "Expected Stdout Byte Offset",
      "actionStdoutOffset",
      ["readIo", "readAll"],
      "number",
      0,
    ),
    property(
      "Expected Stderr Byte Offset",
      "actionStderrOffset",
      ["readIo", "readAll"],
      "number",
      0,
    ),
    {
      ...property(
        "Max Read Bytes",
        "actionMaxBytes",
        ["readIo", "readAll"],
        "number",
        262144,
      ),
      typeOptions: { minValue: 65536, maxValue: 262144, numberPrecision: 0 },
    },
    {
      ...property("Wait (ms)", "actionWaitMs", ["readIo", "readAll"], "number", 20000),
      typeOptions: { minValue: 0, maxValue: 20000, numberPrecision: 0 },
    },
    {
      ...property("Max Total Bytes", "actionTotalBytes", ["readAll"], "number", 8388608),
      typeOptions: { minValue: 1, maxValue: 67108864, numberPrecision: 0 },
    },
    {
      ...property(
        "Read Time Limit (ms)",
        "actionReadTimeout",
        ["readAll"],
        "number",
        30000,
      ),
      typeOptions: { minValue: 1, maxValue: 300000, numberPrecision: 0 },
    },
    {
      displayName:
        "Requires external n8n binary storage. Returns ordered binary chunks, not one in-memory file. On a limit, cancellation or disconnect, persist the returned binaries together with next_sequence and next_offsets before resuming. Check stop_reason and output_complete; stopping this reader does not cancel the remote process. A forced n8n shutdown may discard this call; resume from the last checkpoint saved by your workflow.",
      name: "actionReadAllNotice",
      type: "notice",
      default: "",
      displayOptions: { show: { operation: ["readAll"] } },
    },
  ];
};
