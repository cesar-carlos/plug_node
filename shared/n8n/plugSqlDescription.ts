export * from "./plugSqlDescriptionCommon";
export * from "./plugSqlDescriptionAdvancedOptions";
export * from "./plugSqlDescriptionOperationFields";

import type { INodeProperties } from "n8n-workflow";

import {
  plugSqlBatchAdvancedOptions,
  plugSqlBulkInsertAdvancedOptions,
  plugSqlCancelAdvancedOptions,
  plugSqlDiscoverAdvancedOptions,
  plugSqlProfileAdvancedOptions,
  plugSqlSocketAdvancedOptions,
  plugSqlValidateContextAdvancedOptions,
  plugSqlAdvancedOptions,
} from "./plugSqlDescriptionAdvancedOptions";
import {
  buildPlugSqlIncludeMetadataProperty,
  buildPlugSqlResponseModeProperty,
  plugSqlOperationOptions,
  plugSqlOperationsWithInputMode,
  plugSqlSocketEligibleOperationsV1,
  plugSqlSocketEligibleOperationsV2,
  plugSqlValidateContextOperation,
} from "./plugSqlDescriptionCommon";
import { buildPlugSqlGuidedOperationFields } from "./plugSqlDescriptionOperationFields";

export const buildPlugSqlProperties = (supportsSocket: boolean): INodeProperties[] => {
  const properties: INodeProperties[] = [
    {
      displayName: "Operation",
      name: "operation",
      type: "options",
      default: plugSqlValidateContextOperation,
      options: [...plugSqlOperationOptions],
    },
  ];

  if (supportsSocket) {
    properties.push(
      {
        displayName: "Channel",
        name: "channel",
        type: "options",
        default: "rest",
        description:
          "Choose REST for standard requests or Socket for lower-latency commands and stream-friendly SQL output.",
        options: [
          { name: "REST", value: "rest" },
          { name: "Socket", value: "socket" },
        ],
        displayOptions: {
          show: {
            "@version": [1],
            operation: [...plugSqlSocketEligibleOperationsV1],
          },
        },
      },
      {
        displayName: "Channel",
        name: "channel",
        type: "options",
        default: "rest",
        description:
          "Choose REST for standard requests or Socket for lower-latency commands and stream-friendly SQL output.",
        options: [
          { name: "REST", value: "rest" },
          { name: "Socket", value: "socket" },
        ],
        displayOptions: {
          show: {
            "@version": [2],
            operation: [...plugSqlSocketEligibleOperationsV2],
          },
        },
      },
    );
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
          operation: plugSqlOperationsWithInputMode,
        },
      },
    },
    buildPlugSqlResponseModeProperty(supportsSocket),
    {
      displayName: "Agent ID",
      name: "agentId",
      type: "string",
      default: "",
      description:
        "Optional override for the target Plug agent. Falls back to Default Agent ID from the credential when empty.",
    },
    {
      displayName: "Client Token",
      name: "clientToken",
      type: "string",
      default: "",
      typeOptions: {
        password: true,
      },
      description:
        "Optional override for the Plug client token. Falls back to Default Client Token from the credential when empty.",
    },
    buildPlugSqlIncludeMetadataProperty(),
    ...buildPlugSqlGuidedOperationFields(),
    plugSqlAdvancedOptions,
    plugSqlBatchAdvancedOptions,
    plugSqlBulkInsertAdvancedOptions,
    plugSqlCancelAdvancedOptions,
    plugSqlDiscoverAdvancedOptions,
    plugSqlProfileAdvancedOptions,
    plugSqlValidateContextAdvancedOptions,
    ...(supportsSocket ? [plugSqlSocketAdvancedOptions] : []),
  );

  return properties;
};
