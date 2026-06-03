import type { INodeProperties } from "n8n-workflow";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PayloadFrameCompression,
} from "../contracts/api";
import {
  defaultBinaryPropertyPrefix,
  defaultManualListenTimeoutMs,
  defaultSocketEventAckTimeoutMs,
  defaultSocketEventListenTimeoutMaxMs,
} from "../contracts/custom-socket-events";
import {
  addOperationDisplayOption,
  plugToolPublishSocketEventOperation,
  plugToolWaitForSocketEventOperation,
  type PlugToolsPropertiesOptions,
} from "./plugToolsDescriptionCommon";

export const buildPlugToolsSocketEventProperties = (
  options: PlugToolsPropertiesOptions,
): INodeProperties[] => {
  const publishOperation = options.operation ?? plugToolPublishSocketEventOperation;
  const publishProperties: INodeProperties[] = [
    {
      displayName: "Publish Channel",
      name: "publishChannel",
      type: "options",
      default: "rest",
      options: [
        {
          name: "REST",
          value: "rest",
          description: "Publish through POST /client/me/socket-events",
          action: "Publish through REST",
        },
        ...(options.supportsSocketPublish
          ? [
              {
                name: "Socket",
                value: "socket",
                description: "Publish through socket:event.publish on /consumers",
                action: "Publish through Socket",
              },
            ]
          : []),
      ],
      description: "Transport used to publish the custom event.",
    },
    {
      displayName: "Event Name",
      name: "eventName",
      type: "string",
      default: "client:custom.status.changed",
      required: true,
      description: "Exact custom event name to publish. Must start with client:custom.",
    },
    {
      displayName: "Payload JSON",
      name: "payloadJson",
      type: "json",
      default: "{}",
      required: true,
      description: "JSON payload delivered to subscribers. Use null for a null payload.",
    },
    {
      displayName: "Attachments",
      name: "attachments",
      type: "fixedCollection",
      placeholder: "Add attachment",
      default: {},
      typeOptions: {
        multipleValues: true,
      },
      options: [
        {
          displayName: "Attachment",
          name: "values",
          values: [
            {
              displayName: "Binary Property",
              name: "binaryPropertyName",
              type: "string",
              default: "data",
              required: true,
              description:
                "Name of the binary property to publish as an inline socket event attachment",
            },
          ],
        },
      ],
    },
    {
      displayName: "Payload Frame Compression",
      name: "payloadFrameCompression",
      type: "options",
      default: "default" satisfies PayloadFrameCompression,
      options: [
        { name: "Always", value: "always" },
        { name: "Default", value: "default" },
        { name: "None", value: "none" },
      ],
      description: "Compression preference used by Plug when emitting the PayloadFrame.",
    },
    {
      displayName: "Idempotency Key",
      name: "idempotencyKey",
      type: "string",
      default: "",
      description:
        "Optional retry key. Reusing the same key with the same body returns the original accepted response.",
    },
    {
      displayName: "Timeout (MS)",
      name: "timeoutMs",
      type: "number",
      default: DEFAULT_REQUEST_TIMEOUT_MS,
      typeOptions: {
        minValue: 1,
      },
      description:
        "HTTP timeout for REST publishing. Socket publishing uses Socket ACK Timeout when set.",
    },
    ...(options.supportsSocketPublish
      ? [
          {
            displayName: "Socket ACK Timeout (MS)",
            name: "socketAckTimeoutMs",
            type: "number",
            default: defaultSocketEventAckTimeoutMs,
            typeOptions: {
              minValue: 1,
            },
            displayOptions: {
              show: {
                publishChannel: ["socket"],
              },
            },
            description:
              "Time to wait for connection:ready and socket:event.published when publishing via Socket.",
          } satisfies INodeProperties,
        ]
      : []),
    {
      displayName: "Include Plug Metadata",
      name: "includePlugMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plug object with channel and event metadata in the output.",
    },
  ];

  const properties = publishProperties.map((property) =>
    addOperationDisplayOption(property, publishOperation),
  );

  if (options.operation !== undefined || !options.supportsSocketListen) {
    return properties;
  }

  const waitProperties: INodeProperties[] = [
    {
      displayName: "Event Name",
      name: "eventName",
      type: "string",
      default: "client:custom.status.changed",
      required: true,
      description: "Exact custom event name to wait for. Must start with client:custom.",
    },
    {
      displayName: "Listen Timeout (MS)",
      name: "listenTimeoutMs",
      type: "number",
      default: defaultManualListenTimeoutMs,
      typeOptions: {
        minValue: 1,
        maxValue: defaultSocketEventListenTimeoutMaxMs,
      },
      description: `Maximum time to wait for the first matching socket event after subscribing. Max ${defaultSocketEventListenTimeoutMaxMs} ms.`,
    },
    {
      displayName: "Socket ACK Timeout (MS)",
      name: "socketAckTimeoutMs",
      type: "number",
      default: defaultSocketEventAckTimeoutMs,
      typeOptions: {
        minValue: 1,
      },
      description:
        "Time to wait for connection:ready and socket:event.subscribe acknowledgements.",
    },
    {
      displayName: "Binary Property Prefix",
      name: "binaryPropertyPrefix",
      type: "string",
      default: defaultBinaryPropertyPrefix,
      description: "Prefix for binary properties created from inline event attachments.",
    },
    {
      displayName: "Require Payload Signature",
      name: "requirePayloadSignature",
      type: "boolean",
      default: false,
      description: "Whether inbound PayloadFrames must include a valid HMAC signature.",
    },
    {
      displayName: "Include Plug Metadata",
      name: "includePlugMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plug object with channel and event metadata in the output.",
    },
  ];

  return [
    ...properties,
    ...waitProperties.map((property) =>
      addOperationDisplayOption(property, plugToolWaitForSocketEventOperation),
    ),
  ];
};
