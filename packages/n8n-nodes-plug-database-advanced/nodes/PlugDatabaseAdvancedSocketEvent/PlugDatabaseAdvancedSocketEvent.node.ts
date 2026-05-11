import { Buffer } from "node:buffer";

import type {
  IBinaryData,
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeConnectionTypes, NodeOperationError } from "n8n-workflow";
import { io, type Socket } from "socket.io-client";

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PayloadFrameCompression,
  type PlugCredentialDefaults,
} from "../../generated/shared/contracts/api";
import { PlugError } from "../../generated/shared/contracts/errors";
import {
  buildAuthorizedHeaders,
  createExecutionSessionRunner,
  createHttpError,
} from "../../generated/shared/auth/session";
import {
  assertPublishCustomSocketEventInput,
  assertPublishCustomSocketEventResponse,
  defaultCustomSocketEventFileMaxBytes,
  defaultCustomSocketEventMaxFiles,
  defaultCustomSocketEventPayloadJsonMaxBytes,
  defaultCustomSocketEventTotalFilesMaxBytes,
  defaultSocketEventAckTimeoutMs,
  getJsonUtf8ByteLength,
  normalizeOptionalIdempotencyKey,
  type CustomSocketEventAttachment,
} from "../../generated/shared/contracts/custom-socket-events";
import { buildN8nHttpRequester } from "../../generated/shared/n8n/httpRequester";
import { publishCustomSocketEvent } from "../../generated/shared/rest/customSocketEvents";
import {
  publishCustomSocketEventOverSocket,
  type CustomSocketEventTransport,
} from "../../generated/shared/socket/customSocketEventSession";
import { parseJsonText, isRecord } from "../../generated/shared/utils/json";
import { buildApiUrl, deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

const credentialName = "plugDatabaseAdvancedApi";

type PublishChannel = "rest" | "socket";

interface BinarySocketEventAttachment {
  readonly fieldName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly buffer: Buffer;
}

class SocketIoCustomEventTransport implements CustomSocketEventTransport {
  constructor(private readonly socket: Socket) {}

  get id(): string | undefined {
    return this.socket.id;
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.socket.on(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.socket.off(event, handler);
  }

  emit(event: string, payload?: unknown): void {
    if (payload === undefined) {
      this.socket.emit(event);
      return;
    }

    this.socket.emit(event, payload);
  }
}

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

const resolvePayloadFrameSigning = (
  credentials: PlugCredentialDefaults,
):
  | {
      readonly key?: string;
      readonly keyId?: string;
    }
  | undefined => {
  const key = credentials.payloadSigningKey?.trim();
  const keyId = credentials.payloadSigningKeyId?.trim();
  if (!key && !keyId) {
    return undefined;
  }

  return {
    ...(key ? { key } : {}),
    ...(keyId ? { keyId } : {}),
  };
};

const normalizePublishChannel = (value: unknown, node: INode): PublishChannel => {
  if (value === "rest" || value === "socket") {
    return value;
  }

  throw new NodeOperationError(node, "Publish Channel must be REST or Socket");
};

const normalizePositiveInteger = (
  value: unknown,
  fieldName: string,
  fallback: number,
  node: INode,
): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new NodeOperationError(node, `${fieldName} must be a positive number`);
  }

  return Math.floor(numeric);
};

const readAttachments = async (
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<BinarySocketEventAttachment[]> => {
  const collection = context.getNodeParameter("attachments", itemIndex, {}) as {
    readonly values?: ReadonlyArray<{ readonly binaryPropertyName?: unknown }>;
  };
  const attachments: BinarySocketEventAttachment[] = [];

  for (const row of collection.values ?? []) {
    const binaryPropertyName =
      typeof row.binaryPropertyName === "string" ? row.binaryPropertyName.trim() : "";
    if (binaryPropertyName === "") {
      continue;
    }

    const binaryData = context.helpers.assertBinaryData(
      itemIndex,
      binaryPropertyName,
    ) as IBinaryData;
    const buffer = await context.helpers.getBinaryDataBuffer(
      itemIndex,
      binaryPropertyName,
    );
    attachments.push({
      fieldName: "files",
      originalName: binaryData.fileName ?? `${binaryPropertyName}.bin`,
      mimeType: binaryData.mimeType ?? "application/octet-stream",
      sizeBytes: buffer.byteLength,
      buffer: Buffer.from(buffer),
    });
  }

  return attachments;
};

const validatePublishPayloadAndAttachments = (
  input: {
    readonly payload: unknown;
    readonly attachments: readonly BinarySocketEventAttachment[];
  },
  node: INode,
): void => {
  const payloadBytes = getJsonUtf8ByteLength(input.payload, "Payload JSON");
  if (payloadBytes > defaultCustomSocketEventPayloadJsonMaxBytes) {
    throw new NodeOperationError(
      node,
      `Payload JSON must be at most ${defaultCustomSocketEventPayloadJsonMaxBytes} bytes`,
    );
  }

  if (input.attachments.length > defaultCustomSocketEventMaxFiles) {
    throw new NodeOperationError(
      node,
      `Attachments must include at most ${defaultCustomSocketEventMaxFiles} files`,
    );
  }

  let totalBytes = 0;
  for (const attachment of input.attachments) {
    totalBytes += attachment.sizeBytes;
    if (attachment.sizeBytes > defaultCustomSocketEventFileMaxBytes) {
      throw new NodeOperationError(
        node,
        `Attachment ${attachment.originalName} must be at most ${defaultCustomSocketEventFileMaxBytes} bytes`,
      );
    }
  }

  if (totalBytes > defaultCustomSocketEventTotalFilesMaxBytes) {
    throw new NodeOperationError(
      node,
      `Attachments total size must be at most ${defaultCustomSocketEventTotalFilesMaxBytes} bytes`,
    );
  }
};

const toInlineAttachments = (
  attachments: readonly BinarySocketEventAttachment[],
): CustomSocketEventAttachment[] =>
  attachments.map((attachment) => ({
    fieldName: attachment.fieldName,
    originalName: attachment.originalName,
    mimeType: attachment.mimeType,
    sizeBytes: attachment.sizeBytes,
    base64: attachment.buffer.toString("base64"),
  }));

const parseFullResponseBody = (
  response: unknown,
  node: INode,
): {
  readonly statusCode: number;
  readonly headers: Record<string, string | string[] | undefined>;
  readonly body: unknown;
} => {
  const body = isRecord(response) && "body" in response ? response.body : response;
  const statusCode =
    isRecord(response) && typeof response.statusCode === "number"
      ? response.statusCode
      : 200;
  let parsedBody = body;
  if (typeof body === "string" && /^[\s]*[{[]/.test(body)) {
    try {
      parsedBody = JSON.parse(body) as unknown;
    } catch {
      if (statusCode >= 200 && statusCode < 300) {
        throw new NodeOperationError(
          node,
          "Plug socket event publish response body must be valid JSON",
        );
      }
    }
  }

  return {
    statusCode,
    headers:
      isRecord(response) && isRecord(response.headers)
        ? (response.headers as Record<string, string | string[] | undefined>)
        : {},
    body: parsedBody,
  };
};

const publishCustomSocketEventMultipart = async (
  context: IExecuteFunctions,
  session: Parameters<typeof buildAuthorizedHeaders>[0],
  input: {
    readonly eventName: string;
    readonly payload: unknown;
    readonly payloadFrameCompression?: PayloadFrameCompression;
    readonly idempotencyKey?: string;
    readonly attachments: readonly BinarySocketEventAttachment[];
    readonly timeoutMs: number;
  },
) => {
  const request = assertPublishCustomSocketEventInput({
    eventName: input.eventName,
    payload: input.payload,
    payloadFrameCompression: input.payloadFrameCompression,
    idempotencyKey: input.idempotencyKey,
    timeoutMs: input.timeoutMs,
  });
  const form = new FormData();
  form.append(
    "event",
    JSON.stringify({
      eventName: request.eventName,
      payload: request.payload,
      ...(request.payloadFrameCompression
        ? { payloadFrameCompression: request.payloadFrameCompression }
        : {}),
    }),
  );

  for (const attachment of input.attachments) {
    form.append(
      "files",
      new Blob([new Uint8Array(attachment.buffer)], { type: attachment.mimeType }),
      attachment.originalName,
    );
  }

  const requestOptions: IHttpRequestOptions = {
    method: "POST",
    url: buildApiUrl(session.credentials.baseUrl, "/client/me/socket-events"),
    headers: buildAuthorizedHeaders(
      session,
      request.idempotencyKey ? { "idempotency-key": request.idempotencyKey } : undefined,
    ) as IDataObject,
    body: form,
    timeout: request.timeoutMs,
    returnFullResponse: true,
    ignoreHttpStatusErrors: true,
  };
  const response = parseFullResponseBody(
    await context.helpers.httpRequest(requestOptions),
    context.getNode(),
  );
  if (response.statusCode !== 202) {
    throw createHttpError(response.statusCode, response.body, response.headers);
  }

  return assertPublishCustomSocketEventResponse(response.body);
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
          {
            name: "Socket",
            value: "socket",
            description: "Publish through socket:event.publish on /consumers",
            action: "Publish through Socket",
          },
        ],
        description: "Transport used to publish the custom event",
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
        description:
          "HTTP timeout for REST publishing. Socket publishing uses Socket ACK Timeout when set.",
      },
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
          "Time to wait for connection:ready and socket:event.published when publishing via Socket",
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
        const publishChannel = normalizePublishChannel(
          this.getNodeParameter("publishChannel", itemIndex, "rest"),
          this.getNode(),
        );
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
        const timeoutMs = normalizePositiveInteger(
          this.getNodeParameter("timeoutMs", itemIndex, DEFAULT_REQUEST_TIMEOUT_MS),
          "Timeout (MS)",
          DEFAULT_REQUEST_TIMEOUT_MS,
          this.getNode(),
        );
        const socketAckTimeoutMs = normalizePositiveInteger(
          this.getNodeParameter(
            "socketAckTimeoutMs",
            itemIndex,
            defaultSocketEventAckTimeoutMs,
          ),
          "Socket ACK Timeout (MS)",
          defaultSocketEventAckTimeoutMs,
          this.getNode(),
        );
        const includeMetadata = this.getNodeParameter(
          "includePlugMetadata",
          itemIndex,
          true,
        ) as boolean;
        const attachments = await readAttachments(this, itemIndex);
        validatePublishPayloadAndAttachments(
          {
            payload,
            attachments,
          },
          this.getNode(),
        );

        const result = await sessionRunner(async (session) => {
          if (publishChannel === "socket") {
            const socket = io(
              deriveSocketNamespaceUrl(credentials.baseUrl, "/consumers"),
              {
                autoConnect: false,
                reconnection: false,
                transports: ["websocket"],
                auth: {
                  token: session.accessToken,
                },
              },
            );
            return publishCustomSocketEventOverSocket({
              transport: new SocketIoCustomEventTransport(socket),
              request: {
                eventName,
                payload,
                payloadFrameCompression,
                idempotencyKey,
                attachments: toInlineAttachments(attachments),
                timeoutMs: socketAckTimeoutMs,
              },
              payloadFrameSigning: resolvePayloadFrameSigning(credentials),
            });
          }

          if (attachments.length > 0) {
            return publishCustomSocketEventMultipart(this, session, {
              eventName,
              payload,
              payloadFrameCompression,
              idempotencyKey,
              attachments,
              timeoutMs,
            });
          }

          return publishCustomSocketEvent(requester, session, {
            eventName,
            payload,
            payloadFrameCompression,
            idempotencyKey,
            timeoutMs,
          });
        });

        outputItems.push({
          json: {
            ...result,
            ...(includeMetadata
              ? {
                  __plug: {
                    channel: publishChannel,
                    operation: "publishCustomSocketEvent",
                    eventName: result.eventName,
                    eventId: result.eventId,
                    recipients: result.recipients,
                    attachmentCount: attachments.length,
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
