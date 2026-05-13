import { Buffer } from "node:buffer";

import type {
  IBinaryData,
  IBinaryKeyData,
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import {
  DEFAULT_BASE_URL,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PayloadFrameCompression,
  type PlugCredentialDefaults,
  type PlugSession,
} from "../contracts/api";
import {
  assertPublishCustomSocketEventInput,
  assertPublishCustomSocketEventResponse,
  defaultBinaryPropertyPrefix,
  defaultCustomSocketEventFileMaxBytes,
  defaultCustomSocketEventMaxFiles,
  defaultCustomSocketEventPayloadJsonMaxBytes,
  defaultCustomSocketEventTotalFilesMaxBytes,
  defaultManualListenTimeoutMs,
  defaultSocketEventAckTimeoutMs,
  defaultSocketEventListenTimeoutMaxMs,
  getJsonUtf8ByteLength,
  normalizeOptionalIdempotencyKey,
  toAttachmentMetadata,
  type CustomSocketEventAttachment,
  type PublishCustomSocketEventResponse,
} from "../contracts/custom-socket-events";
import { PlugValidationError } from "../contracts/errors";
import {
  buildAuthorizedHeaders,
  createExecutionSessionRunner,
  createHttpError,
} from "../auth/session";
import { publishCustomSocketEvent } from "../rest/customSocketEvents";
import { buildN8nHttpRequester } from "./httpRequester";
import {
  plugToolPublishSocketEventOperation,
  plugToolWaitForSocketEventOperation,
} from "./plugToolsDescription";
import {
  emptyInputItem,
  serializeErrorForContinueOnFail,
  toNodeOperationError,
  toOptionalString,
  type PlugToolsExecutionConfig,
  type PlugToolsSocketEventListenResult,
} from "./plugToolsCommon";
import { isRecord, parseJsonText } from "../utils/json";
import { buildApiUrl } from "../utils/url";

type PublishChannel = "rest" | "socket";
type SocketEventDeliveryStatus = "delivered" | "noRecipients";
const legacyPublishSocketEventOperation = "publishEvent";

interface BinarySocketEventAttachment {
  readonly fieldName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly buffer: Buffer;
}

const readCredentials = async (
  context: IExecuteFunctions,
  credentialName: string,
): Promise<PlugCredentialDefaults> => {
  const rawCredentials = await context.getCredentials(credentialName);
  return {
    user: String(rawCredentials.user ?? ""),
    password: String(rawCredentials.password ?? ""),
    baseUrl: String(rawCredentials.baseUrl ?? DEFAULT_BASE_URL),
    agentId: toOptionalString(rawCredentials.agentId),
    clientToken: toOptionalString(rawCredentials.clientToken),
    payloadSigningKey: toOptionalString(rawCredentials.payloadSigningKey),
    payloadSigningKeyId: toOptionalString(rawCredentials.payloadSigningKeyId),
  };
};

const normalizePublishChannel = (
  value: unknown,
  node: INode,
  supportsSocketPublish: boolean,
): PublishChannel => {
  if (value === "rest") {
    return value;
  }

  if (value === "socket" && supportsSocketPublish) {
    return value;
  }

  throw new NodeOperationError(
    node,
    supportsSocketPublish
      ? "Publish Channel must be REST or Socket"
      : "Publish Channel must be REST",
  );
};

const normalizePositiveInteger = (
  value: unknown,
  fieldName: string,
  fallback: number,
  node: INode,
  max?: number,
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

  const normalized = Math.floor(numeric);
  if (max !== undefined && normalized > max) {
    throw new NodeOperationError(node, `${fieldName} must be at most ${max}`);
  }

  return normalized;
};

const normalizeBinaryPropertyPrefix = (value: unknown, node: INode): string => {
  const prefix =
    typeof value === "string" && value.trim() !== ""
      ? value.trim()
      : defaultBinaryPropertyPrefix;

  if (!/^[A-Za-z0-9_-]+$/.test(prefix)) {
    throw new NodeOperationError(
      node,
      "Binary Property Prefix may contain only letters, numbers, underscores, and hyphens",
    );
  }

  return prefix;
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

const assertPayloadSigningKeyForRequiredFrames = (
  credentials: PlugCredentialDefaults,
): void => {
  if (!credentials.payloadSigningKey?.trim()) {
    throw new PlugValidationError(
      "Payload Signing Key is required when Require Payload Signature is enabled.",
    );
  }
};

const readSocketEventAttachments = async (
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

const validateSocketEventPayloadAndAttachments = (
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

const toInlineSocketEventAttachments = (
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
  session: PlugSession<PlugCredentialDefaults>,
  input: {
    readonly eventName: string;
    readonly payload: unknown;
    readonly payloadFrameCompression?: PayloadFrameCompression;
    readonly idempotencyKey?: string;
    readonly attachments: readonly BinarySocketEventAttachment[];
    readonly timeoutMs: number;
  },
): Promise<PublishCustomSocketEventResponse> => {
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

const buildWaitForSocketEventOutputItem = async (
  context: IExecuteFunctions,
  input: {
    readonly result: PlugToolsSocketEventListenResult;
    readonly binaryPropertyPrefix: string;
    readonly includeMetadata: boolean;
    readonly itemIndex: number;
  },
): Promise<INodeExecutionData> => {
  const binary: IBinaryKeyData = {};
  const { event, metadata } = input.result;

  for (let index = 0; index < event.attachments.length; index += 1) {
    const attachment = event.attachments[index];
    const propertyName = `${input.binaryPropertyPrefix}_${index}`;
    binary[propertyName] = await context.helpers.prepareBinaryData(
      Buffer.from(attachment.base64.trim(), "base64"),
      attachment.originalName,
      attachment.mimeType,
    );
  }

  return {
    json: {
      eventId: event.eventId,
      eventName: event.eventName,
      emittedAt: event.emittedAt,
      publisher: event.publisher,
      payload: event.payload as IDataObject,
      attachments: event.attachments.map(
        toAttachmentMetadata,
      ) as unknown as IDataObject[],
      ...(input.includeMetadata
        ? {
            __plug: {
              channel: "socket",
              operation: "waitForSocketEvent",
              eventName: event.eventName,
              eventId: event.eventId,
              socketId: metadata.socketId,
              receivedAt: new Date().toISOString(),
              payloadFrameRequestId: metadata.payloadFrameRequestId,
              subscriptionCount: metadata.subscriptionCount,
              attachmentCount: event.attachments.length,
            },
          }
        : {}),
    },
    pairedItem: {
      item: input.itemIndex,
    },
    ...(Object.keys(binary).length > 0 ? { binary } : {}),
  };
};

export const executePlugToolsSocketEventNode = async (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const sourceItems = context.getInputData();
  const items = sourceItems.length > 0 ? sourceItems : [emptyInputItem];
  const credentials = await readCredentials(
    context,
    config.credentialName ?? "plugDatabaseAccountApi",
  );
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const rawOperation = context.getNodeParameter(
        "operation",
        itemIndex,
        plugToolPublishSocketEventOperation,
      );
      const operation =
        typeof rawOperation === "string" && rawOperation.trim() !== ""
          ? rawOperation
          : plugToolPublishSocketEventOperation;
      const eventName = context.getNodeParameter("eventName", itemIndex) as string;
      const includeMetadata = context.getNodeParameter(
        "includePlugMetadata",
        itemIndex,
        true,
      ) as boolean;

      if (operation === plugToolWaitForSocketEventOperation) {
        const socketEventListener = config.socketEventListener;
        if (!socketEventListener) {
          throw new PlugValidationError(
            "This package does not support waiting for socket events.",
          );
        }

        const listenTimeoutMs = normalizePositiveInteger(
          context.getNodeParameter(
            "listenTimeoutMs",
            itemIndex,
            defaultManualListenTimeoutMs,
          ),
          "Listen Timeout (MS)",
          defaultManualListenTimeoutMs,
          context.getNode(),
          defaultSocketEventListenTimeoutMaxMs,
        );
        const socketAckTimeoutMs = normalizePositiveInteger(
          context.getNodeParameter(
            "socketAckTimeoutMs",
            itemIndex,
            defaultSocketEventAckTimeoutMs,
          ),
          "Socket ACK Timeout (MS)",
          defaultSocketEventAckTimeoutMs,
          context.getNode(),
        );
        const binaryPropertyPrefix = normalizeBinaryPropertyPrefix(
          context.getNodeParameter(
            "binaryPropertyPrefix",
            itemIndex,
            defaultBinaryPropertyPrefix,
          ),
          context.getNode(),
        );
        const requirePayloadSignature = context.getNodeParameter(
          "requirePayloadSignature",
          itemIndex,
          false,
        ) as boolean;
        if (requirePayloadSignature) {
          assertPayloadSigningKeyForRequiredFrames(credentials);
        }

        const payloadFrameSigning = resolvePayloadFrameSigning(credentials);
        const result = await sessionRunner((session) =>
          socketEventListener({
            session,
            eventName,
            listenTimeoutMs,
            ackTimeoutMs: socketAckTimeoutMs,
            payloadFrameSigning,
            requirePayloadSignature,
          }),
        );

        outputItems.push(
          await buildWaitForSocketEventOutputItem(context, {
            result,
            binaryPropertyPrefix,
            includeMetadata,
            itemIndex,
          }),
        );
        continue;
      }

      if (
        operation !== plugToolPublishSocketEventOperation &&
        operation !== legacyPublishSocketEventOperation
      ) {
        throw new PlugValidationError(`Unsupported socket event operation: ${operation}`);
      }

      const publishChannel = normalizePublishChannel(
        context.getNodeParameter("publishChannel", itemIndex, "rest"),
        context.getNode(),
        config.socketEventPublisher !== undefined,
      );
      const payloadJson = context.getNodeParameter("payloadJson", itemIndex) as string;
      const payload = parseJsonText(payloadJson, "Payload JSON");
      const payloadFrameCompression = context.getNodeParameter(
        "payloadFrameCompression",
        itemIndex,
        "default",
      ) as PayloadFrameCompression;
      const idempotencyKey = normalizeOptionalIdempotencyKey(
        context.getNodeParameter("idempotencyKey", itemIndex, ""),
      );
      const timeoutMs = normalizePositiveInteger(
        context.getNodeParameter("timeoutMs", itemIndex, DEFAULT_REQUEST_TIMEOUT_MS),
        "Timeout (MS)",
        DEFAULT_REQUEST_TIMEOUT_MS,
        context.getNode(),
      );
      const socketAckTimeoutMs = normalizePositiveInteger(
        context.getNodeParameter(
          "socketAckTimeoutMs",
          itemIndex,
          defaultSocketEventAckTimeoutMs,
        ),
        "Socket ACK Timeout (MS)",
        defaultSocketEventAckTimeoutMs,
        context.getNode(),
      );
      const attachments = await readSocketEventAttachments(context, itemIndex);
      validateSocketEventPayloadAndAttachments(
        {
          payload,
          attachments,
        },
        context.getNode(),
      );

      const result = await sessionRunner(async (session) => {
        if (publishChannel === "socket") {
          if (!config.socketEventPublisher) {
            throw new PlugValidationError(
              "This package does not support publishing socket events over Socket.",
            );
          }

          return config.socketEventPublisher({
            session,
            eventName,
            payload,
            payloadFrameCompression,
            idempotencyKey,
            attachments: toInlineSocketEventAttachments(attachments),
            timeoutMs: socketAckTimeoutMs,
            payloadFrameSigning: resolvePayloadFrameSigning(credentials),
          });
        }

        if (attachments.length > 0) {
          return publishCustomSocketEventMultipart(context, session, {
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
                  requestId: result.requestId,
                  idempotentReplay: result.idempotentReplay,
                  deliveryStatus: (result.recipients > 0
                    ? "delivered"
                    : "noRecipients") as SocketEventDeliveryStatus,
                  attachmentCount: attachments.length,
                  ...(result.publisherSocketId
                    ? { publisherSocketId: result.publisherSocketId }
                    : {}),
                },
              }
            : {}),
        },
        pairedItem: {
          item: itemIndex,
        },
      });
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
        continue;
      }

      throw toNodeOperationError(context, error, config.nodeDisplayName, itemIndex);
    }
  }

  return [outputItems];
};
