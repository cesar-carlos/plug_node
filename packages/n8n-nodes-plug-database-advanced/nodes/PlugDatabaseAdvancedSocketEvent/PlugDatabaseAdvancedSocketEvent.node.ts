import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PayloadFrameCompression,
  type PlugCredentialDefaults,
} from "../../generated/shared/contracts/api";
import { PlugError } from "../../generated/shared/contracts/errors";
import { createExecutionSessionRunner } from "../../generated/shared/auth/session";
import { normalizeOptionalIdempotencyKey } from "../../generated/shared/contracts/custom-socket-events";
import { buildN8nHttpRequester } from "../../generated/shared/n8n/httpRequester";
import { publishCustomSocketEvent } from "../../generated/shared/rest/customSocketEvents";
import { parseJsonText } from "../../generated/shared/utils/json";

const credentialName = "plugDatabaseAdvancedApi";

const readCredentials = async (
  context: IExecuteFunctions,
): Promise<PlugCredentialDefaults> => {
  const rawCredentials = await context.getCredentials(credentialName);
  return {
    user: String(rawCredentials.user ?? ""),
    password: String(rawCredentials.password ?? ""),
    baseUrl: String(rawCredentials.baseUrl ?? DEFAULT_BASE_URL),
    agentId: String(rawCredentials.agentId ?? ""),
    clientToken: String(rawCredentials.clientToken ?? ""),
    payloadSigningKey: String(rawCredentials.payloadSigningKey ?? ""),
    payloadSigningKeyId: String(rawCredentials.payloadSigningKeyId ?? ""),
  };
};

const serializeErrorForContinueOnFail = (error: unknown): Record<string, unknown> => {
  if (error instanceof PlugError) {
    return {
      message: error.message,
      description: error.description,
      code: error.code,
      statusCode: error.statusCode,
      correlationId: error.correlationId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return { message: "Unknown error" };
};

export class PlugDatabaseAdvancedSocketEvent implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Plug Database Advanced Socket Event",
    name: "plugDatabaseAdvancedSocketEvent",
    icon: "file:plugDatabaseAdvancedSocketEvent.svg",
    group: ["transform"],
    version: 1,
    subtitle: '={{$parameter["operation"]}}',
    description: "Publish custom Plug Socket events to subscribed consumers.",
    defaults: {
      name: "Plug Socket Event",
    },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: credentialName,
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Operation",
        name: "operation",
        type: "options",
        default: "publishEvent",
        noDataExpression: true,
        options: [
          {
            name: "Publish Event",
            value: "publishEvent",
            description: "Publish a client:custom.* event through Plug",
            action: "Publish a socket event",
          },
        ],
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
        description:
          "JSON payload delivered to subscribers. Use null for a null payload.",
      },
      {
        displayName: "Payload Frame Compression",
        name: "payloadFrameCompression",
        type: "options",
        default: "default",
        options: [
          { name: "Always", value: "always" },
          { name: "Default", value: "default" },
          { name: "None", value: "none" },
        ],
        description: "Compression preference used by Plug when emitting the PayloadFrame",
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
        description: "HTTP timeout for publishing the event",
      },
      {
        displayName: "Include Plug Metadata",
        name: "includePlugMetadata",
        type: "boolean",
        default: true,
        description:
          "Whether to include the __plug object with channel and event metadata in the output",
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const inputItems = this.getInputData();
    const items =
      inputItems.length > 0
        ? inputItems
        : [{ json: {}, pairedItem: { item: 0 } } as INodeExecutionData];
    const credentials = await readCredentials(this);
    const requester = buildN8nHttpRequester(this);
    const sessionRunner = createExecutionSessionRunner(requester, credentials);
    const outputItems: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const eventName = this.getNodeParameter("eventName", itemIndex) as string;
        const payloadJson = this.getNodeParameter("payloadJson", itemIndex) as string;
        const payload = parseJsonText(payloadJson, "Payload JSON");
        const payloadFrameCompression = this.getNodeParameter(
          "payloadFrameCompression",
          itemIndex,
          "default",
        ) as PayloadFrameCompression;
        const idempotencyKey = normalizeOptionalIdempotencyKey(
          this.getNodeParameter("idempotencyKey", itemIndex, ""),
        );
        const timeoutMs = this.getNodeParameter(
          "timeoutMs",
          itemIndex,
          DEFAULT_REQUEST_TIMEOUT_MS,
        ) as number;
        const includeMetadata = this.getNodeParameter(
          "includePlugMetadata",
          itemIndex,
          true,
        ) as boolean;

        const result = await sessionRunner((session) =>
          publishCustomSocketEvent(requester, session, {
            eventName,
            payload,
            payloadFrameCompression,
            idempotencyKey,
            timeoutMs,
          }),
        );

        outputItems.push({
          json: {
            ...result,
            ...(includeMetadata
              ? {
                  __plug: {
                    channel: "rest",
                    operation: "publishCustomSocketEvent",
                    eventName: result.eventName,
                    eventId: result.eventId,
                    recipients: result.recipients,
                  },
                }
              : {}),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
      } catch (error: unknown) {
        if (!this.continueOnFail()) {
          throw error;
        }

        outputItems.push({
          json: {
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
      }
    }

    return [outputItems];
  }
}
