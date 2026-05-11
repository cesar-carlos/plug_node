import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type JsonObject,
  type PayloadFrameCompression,
} from "./api";
import { PlugValidationError } from "./errors";
import { isRecord } from "../utils/json";

export const customSocketEventPrefix = "client:custom." as const;
export const clientAgentProfileUpdatedEventName = "client:agent.profile.updated" as const;
export const customSocketEventNameMaxLength = 128;
export const defaultSocketEventAckTimeoutMs = 10_000;
export const defaultManualListenTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
export const defaultBinaryPropertyPrefix = "attachment";
export const defaultMaxInflightSocketEvents = 8;
export const defaultMaxQueuedSocketEvents = 128;
export const defaultCustomSocketEventMaxFiles = 5;
export const defaultCustomSocketEventFileMaxBytes = 524_288;
export const defaultCustomSocketEventTotalFilesMaxBytes = 2_097_152;
export const defaultCustomSocketEventPayloadJsonMaxBytes = 524_288;
export const defaultSocketEventDeduplicationTtlMs = 300_000;
export const defaultSocketEventDeduplicationMaxEntries = 4096;

const customSocketEventNamePattern = /^client:custom\.[A-Za-z0-9][A-Za-z0-9._:-]{0,113}$/;

export interface CustomSocketEventAttachment {
  readonly fieldName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly base64: string;
}

export interface CustomSocketEventAttachmentMetadata {
  readonly fieldName: string;
  readonly originalName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export interface CustomSocketEventPublisher extends JsonObject {
  readonly principalType?: string;
  readonly clientId?: string;
}

export interface CustomSocketEventFramePayload extends JsonObject {
  readonly eventId: string;
  readonly eventName: string;
  readonly emittedAt: string;
  readonly publisher: CustomSocketEventPublisher;
  readonly payload: unknown;
  readonly attachments: readonly CustomSocketEventAttachment[];
}

export interface PublishCustomSocketEventInput {
  readonly eventName: string;
  readonly payload: unknown;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly idempotencyKey?: string;
  readonly attachments?: readonly CustomSocketEventAttachment[];
  readonly timeoutMs?: number;
}

export interface CustomSocketEventPublishLimitOptions {
  readonly maxFiles?: number;
  readonly maxFileBytes?: number;
  readonly maxTotalFileBytes?: number;
  readonly maxPayloadJsonBytes?: number;
}

export interface PublishCustomSocketEventResponse extends JsonObject {
  readonly success: true;
  readonly eventId: string;
  readonly eventName: string;
  readonly recipients: number;
  readonly idempotencyKey?: string;
  readonly idempotentReplay?: boolean;
  readonly requestId?: string;
}

export type SocketEventOverflowPolicy = "fail" | "dropNewest" | "dropOldest";

export interface SocketEventRuntimeMetadata {
  readonly eventName: string;
  readonly socketId?: string;
  readonly reconnectAttempt: number;
  readonly subscriptionCount: number;
  readonly payloadFrameRequestId?: string;
}

export interface AgentProfileUpdatedPayload extends JsonObject {
  readonly success?: true;
  readonly agent_id?: string;
  readonly agentId?: string;
  readonly profile_version?: number;
  readonly profileVersion?: number;
  readonly profileUpdatedAt?: string;
  readonly changed_fields?: readonly string[];
  readonly changedFields?: readonly string[];
  readonly source?: string;
}

export type SocketEventPublishedAck =
  | {
      readonly success: true;
      readonly requestId: string;
      readonly data: {
        readonly eventId: string;
        readonly eventName: string;
        readonly recipients: number;
        readonly idempotencyKey?: string;
        readonly idempotentReplay: boolean;
      };
    }
  | {
      readonly success: false;
      readonly requestId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly statusCode?: number;
        readonly retryAfterMs?: number;
      };
      readonly rateLimit?: {
        readonly limit: number;
        readonly remaining: number;
        readonly resetAtMs: number;
      };
    };

export type SocketEventControlAck =
  | {
      readonly success: true;
      readonly requestId: string;
      readonly data: {
        readonly eventName: string;
        readonly subscribed: boolean;
      };
    }
  | {
      readonly success: false;
      readonly requestId: string;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly statusCode?: number;
        readonly retryAfterMs?: number;
      };
      readonly rateLimit?: {
        readonly limit: number;
        readonly remaining: number;
        readonly resetAtMs: number;
      };
    };

export const assertCustomSocketEventName = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new PlugValidationError("Event Name must be a string");
  }

  const eventName = value.trim();
  if (!customSocketEventNamePattern.test(eventName)) {
    throw new PlugValidationError(
      "Event Name must start with client:custom. and contain only letters, numbers, dot, colon, underscore or hyphen",
    );
  }

  if (eventName.length > customSocketEventNameMaxLength) {
    throw new PlugValidationError("Event Name must be at most 128 characters");
  }

  return eventName;
};

export const assertCustomSocketEventNames = (values: readonly unknown[]): string[] => {
  const eventNames = values.map((value) => assertCustomSocketEventName(value));
  const unique = [...new Set(eventNames)];
  if (unique.length === 0) {
    throw new PlugValidationError("At least one Event Name is required");
  }

  return unique;
};

export const normalizeOptionalIdempotencyKey = (value: unknown): string | undefined => {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlugValidationError("Idempotency Key must be a string");
  }

  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  if (trimmed.length > 128) {
    throw new PlugValidationError("Idempotency Key must be at most 128 characters");
  }

  if (!/^[A-Za-z0-9._:-]+$/.test(trimmed)) {
    throw new PlugValidationError(
      "Idempotency Key may contain only letters, numbers, dot, colon, underscore or hyphen",
    );
  }

  return trimmed;
};

export const assertPublishCustomSocketEventResponse = (
  value: unknown,
): PublishCustomSocketEventResponse => {
  if (!isRecord(value)) {
    throw new PlugValidationError("Plug socket event publish response must be an object");
  }

  if (value.success !== true) {
    throw new PlugValidationError(
      "Plug socket event publish response must be successful",
    );
  }

  if (typeof value.eventId !== "string" || value.eventId.trim() === "") {
    throw new PlugValidationError(
      "Plug socket event publish response is missing eventId",
    );
  }

  if (typeof value.eventName !== "string" || value.eventName.trim() === "") {
    throw new PlugValidationError(
      "Plug socket event publish response is missing eventName",
    );
  }

  if (typeof value.recipients !== "number" || !Number.isFinite(value.recipients)) {
    throw new PlugValidationError(
      "Plug socket event publish response is missing recipients",
    );
  }

  return value as unknown as PublishCustomSocketEventResponse;
};

export const assertPublishCustomSocketEventInput = (
  value: unknown,
): PublishCustomSocketEventInput => {
  if (!isRecord(value)) {
    throw new PlugValidationError("Plug socket event publish input must be an object");
  }

  const eventName = assertCustomSocketEventName(value.eventName);
  const idempotencyKey = normalizeOptionalIdempotencyKey(value.idempotencyKey);

  if (!("payload" in value) || value.payload === undefined) {
    throw new PlugValidationError("Plug socket event publish input is missing payload");
  }

  if (
    value.payloadFrameCompression !== undefined &&
    value.payloadFrameCompression !== "default" &&
    value.payloadFrameCompression !== "none" &&
    value.payloadFrameCompression !== "always"
  ) {
    throw new PlugValidationError(
      "Payload Frame Compression must be default, none or always",
    );
  }

  if (
    value.timeoutMs !== undefined &&
    (typeof value.timeoutMs !== "number" ||
      !Number.isFinite(value.timeoutMs) ||
      value.timeoutMs <= 0)
  ) {
    throw new PlugValidationError("Timeout (MS) must be a positive number");
  }

  if (value.attachments !== undefined) {
    if (!Array.isArray(value.attachments)) {
      throw new PlugValidationError("Attachments must be an array");
    }

    for (const attachment of value.attachments) {
      assertCustomSocketEventAttachment(attachment);
    }
  }

  return {
    eventName,
    payload: value.payload,
    ...(value.payloadFrameCompression !== undefined
      ? {
          payloadFrameCompression:
            value.payloadFrameCompression as PayloadFrameCompression,
        }
      : {}),
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    ...(value.attachments !== undefined
      ? {
          attachments:
            value.attachments as unknown as readonly CustomSocketEventAttachment[],
        }
      : {}),
    ...(value.timeoutMs !== undefined ? { timeoutMs: value.timeoutMs as number } : {}),
  };
};

export const getJsonUtf8ByteLength = (value: unknown, label: string): number => {
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    throw new PlugValidationError(`${label} must be JSON-serializable`);
  }

  if (serialized === undefined) {
    throw new PlugValidationError(`${label} must be JSON-serializable`);
  }

  return Buffer.byteLength(serialized, "utf8");
};

export const assertPublishCustomSocketEventInputWithinLimits = (
  value: PublishCustomSocketEventInput,
  options: CustomSocketEventPublishLimitOptions = {},
): void => {
  const maxFiles = options.maxFiles ?? defaultCustomSocketEventMaxFiles;
  const maxFileBytes = options.maxFileBytes ?? defaultCustomSocketEventFileMaxBytes;
  const maxTotalFileBytes =
    options.maxTotalFileBytes ?? defaultCustomSocketEventTotalFilesMaxBytes;
  const maxPayloadJsonBytes =
    options.maxPayloadJsonBytes ?? defaultCustomSocketEventPayloadJsonMaxBytes;
  const payloadBytes = getJsonUtf8ByteLength(value.payload, "Payload JSON");

  if (payloadBytes > maxPayloadJsonBytes) {
    throw new PlugValidationError(
      `Payload JSON must be at most ${maxPayloadJsonBytes} bytes`,
    );
  }

  const attachments = value.attachments ?? [];
  if (attachments.length > maxFiles) {
    throw new PlugValidationError(`Attachments must include at most ${maxFiles} files`);
  }

  let totalBytes = 0;
  for (const attachment of attachments) {
    totalBytes += attachment.sizeBytes;
    if (attachment.sizeBytes > maxFileBytes) {
      throw new PlugValidationError(
        `Attachment ${attachment.originalName} must be at most ${maxFileBytes} bytes`,
      );
    }
  }

  if (totalBytes > maxTotalFileBytes) {
    throw new PlugValidationError(
      `Attachments total size must be at most ${maxTotalFileBytes} bytes`,
    );
  }
};

export const assertSocketEventPublishedAck = (
  value: unknown,
): SocketEventPublishedAck => {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new PlugValidationError(
      "socket:event.published ack must include success boolean",
    );
  }

  if (typeof value.requestId !== "string" || value.requestId.trim() === "") {
    throw new PlugValidationError("socket:event.published ack must include requestId");
  }

  if (value.success) {
    if (!isRecord(value.data)) {
      throw new PlugValidationError("socket:event.published success must include data");
    }
    if (typeof value.data.eventId !== "string" || value.data.eventId.trim() === "") {
      throw new PlugValidationError("socket:event.published data is missing eventId");
    }
    if (typeof value.data.eventName !== "string" || value.data.eventName.trim() === "") {
      throw new PlugValidationError("socket:event.published data is missing eventName");
    }
    if (
      typeof value.data.recipients !== "number" ||
      !Number.isFinite(value.data.recipients)
    ) {
      throw new PlugValidationError("socket:event.published data is missing recipients");
    }
    if (typeof value.data.idempotentReplay !== "boolean") {
      throw new PlugValidationError(
        "socket:event.published data is missing idempotentReplay",
      );
    }
  } else {
    if (
      !isRecord(value.error) ||
      typeof value.error.code !== "string" ||
      value.error.code.trim() === "" ||
      typeof value.error.message !== "string" ||
      value.error.message.trim() === ""
    ) {
      throw new PlugValidationError(
        "socket:event.published failure must include error.code and error.message",
      );
    }

    assertOptionalRateLimit(value.rateLimit, "socket:event.published");
  }

  return value as unknown as SocketEventPublishedAck;
};

export const assertSocketEventControlAck = (value: unknown): SocketEventControlAck => {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new PlugValidationError("socket:event ack must include success boolean");
  }

  if (value.success) {
    if (typeof value.requestId !== "string" || value.requestId.trim() === "") {
      throw new PlugValidationError("socket:event ack success must include requestId");
    }
    if (!isRecord(value.data)) {
      throw new PlugValidationError("socket:event ack success must include data");
    }
    if (typeof value.data.eventName !== "string" || value.data.eventName.trim() === "") {
      throw new PlugValidationError(
        "socket:event ack success must include data.eventName",
      );
    }
    if (typeof value.data.subscribed !== "boolean") {
      throw new PlugValidationError(
        "socket:event ack success must include data.subscribed",
      );
    }
  } else {
    if (typeof value.requestId !== "string" || value.requestId.trim() === "") {
      throw new PlugValidationError("socket:event ack failure must include requestId");
    }

    if (
      !isRecord(value.error) ||
      typeof value.error.code !== "string" ||
      value.error.code.trim() === "" ||
      typeof value.error.message !== "string" ||
      value.error.message.trim() === ""
    ) {
      throw new PlugValidationError(
        "socket:event ack failure must include error.code and error.message",
      );
    }

    assertOptionalRateLimit(value.rateLimit, "socket:event ack failure");
  }

  return value as unknown as SocketEventControlAck;
};

export const assertCustomSocketEventFramePayload = (
  value: unknown,
): CustomSocketEventFramePayload => {
  if (!isRecord(value)) {
    throw new PlugValidationError("Custom socket event payload must be an object");
  }

  if (typeof value.eventId !== "string" || value.eventId.trim() === "") {
    throw new PlugValidationError("Custom socket event payload is missing eventId");
  }

  const eventName = assertCustomSocketEventName(value.eventName);
  if (
    typeof value.emittedAt !== "string" ||
    value.emittedAt.trim() === "" ||
    Number.isNaN(Date.parse(value.emittedAt))
  ) {
    throw new PlugValidationError("Custom socket event payload is missing emittedAt");
  }

  if (!isRecord(value.publisher)) {
    throw new PlugValidationError("Custom socket event payload is missing publisher");
  }
  assertCustomSocketEventPublisher(value.publisher);

  if (!("payload" in value)) {
    throw new PlugValidationError("Custom socket event payload is missing payload");
  }

  if (!Array.isArray(value.attachments)) {
    throw new PlugValidationError("Custom socket event payload is missing attachments");
  }

  for (const attachment of value.attachments) {
    assertCustomSocketEventAttachment(attachment);
  }

  return {
    ...(value as unknown as CustomSocketEventFramePayload),
    eventName,
  };
};

export const assertAgentProfileUpdatedPayload = (
  value: unknown,
): AgentProfileUpdatedPayload => {
  if (!isRecord(value)) {
    throw new PlugValidationError("Agent profile updated payload must be an object");
  }

  if (value.success !== undefined && value.success !== true) {
    throw new PlugValidationError("Agent profile updated payload success must be true");
  }

  const agentId = value.agent_id ?? value.agentId;
  if (typeof agentId !== "string" || agentId.trim() === "") {
    throw new PlugValidationError("Agent profile updated payload is missing agent_id");
  }

  const profileVersion = value.profile_version ?? value.profileVersion;
  if (
    typeof profileVersion !== "number" ||
    !Number.isInteger(profileVersion) ||
    profileVersion < 0
  ) {
    throw new PlugValidationError(
      "Agent profile updated payload is missing profile_version",
    );
  }

  const profileUpdatedAt = value.profileUpdatedAt;
  if (
    profileUpdatedAt !== null &&
    profileUpdatedAt !== undefined &&
    (typeof profileUpdatedAt !== "string" || Number.isNaN(Date.parse(profileUpdatedAt)))
  ) {
    throw new PlugValidationError(
      "Agent profile updated payload profileUpdatedAt must be an ISO date string",
    );
  }

  const changedFields = value.changed_fields ?? value.changedFields;
  if (
    changedFields !== undefined &&
    (!Array.isArray(changedFields) ||
      changedFields.some((field) => typeof field !== "string"))
  ) {
    throw new PlugValidationError(
      "Agent profile updated payload changed_fields must be an array of strings",
    );
  }

  if (
    value.source !== undefined &&
    (typeof value.source !== "string" || value.source.trim() === "")
  ) {
    throw new PlugValidationError(
      "Agent profile updated payload source must be a string",
    );
  }

  return value as AgentProfileUpdatedPayload;
};

export const toAttachmentMetadata = (
  attachment: CustomSocketEventAttachment,
): CustomSocketEventAttachmentMetadata => ({
  fieldName: attachment.fieldName,
  originalName: attachment.originalName,
  mimeType: attachment.mimeType,
  sizeBytes: attachment.sizeBytes,
});

const assertCustomSocketEventAttachment = (
  value: unknown,
): CustomSocketEventAttachment => {
  if (!isRecord(value)) {
    throw new PlugValidationError("Custom socket event attachment must be an object");
  }

  if (typeof value.fieldName !== "string" || value.fieldName.trim() === "") {
    throw new PlugValidationError("Custom socket event attachment is missing fieldName");
  }

  if (typeof value.originalName !== "string" || value.originalName.trim() === "") {
    throw new PlugValidationError(
      "Custom socket event attachment is missing originalName",
    );
  }

  if (typeof value.mimeType !== "string" || value.mimeType.trim() === "") {
    throw new PlugValidationError("Custom socket event attachment is missing mimeType");
  }

  if (
    typeof value.sizeBytes !== "number" ||
    !Number.isInteger(value.sizeBytes) ||
    value.sizeBytes < 0
  ) {
    throw new PlugValidationError("Custom socket event attachment is missing sizeBytes");
  }

  if (typeof value.base64 !== "string") {
    throw new PlugValidationError("Custom socket event attachment is missing base64");
  }

  const compactBase64 = value.base64.trim();
  if (compactBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(compactBase64)) {
    throw new PlugValidationError("Custom socket event attachment base64 is invalid");
  }

  const decodedSizeBytes = Buffer.from(compactBase64, "base64").byteLength;
  if (decodedSizeBytes !== value.sizeBytes) {
    throw new PlugValidationError(
      "Custom socket event attachment sizeBytes does not match base64 payload",
    );
  }

  return value as unknown as CustomSocketEventAttachment;
};

const assertCustomSocketEventPublisher = (value: Record<string, unknown>): void => {
  if (
    value.principalType !== undefined &&
    (typeof value.principalType !== "string" || value.principalType.trim() === "")
  ) {
    throw new PlugValidationError(
      "Custom socket event publisher principalType must be a string",
    );
  }

  if (
    value.clientId !== undefined &&
    (typeof value.clientId !== "string" || value.clientId.trim() === "")
  ) {
    throw new PlugValidationError(
      "Custom socket event publisher clientId must be a string",
    );
  }
};

const assertOptionalRateLimit = (value: unknown, context: string): void => {
  if (value === undefined) {
    return;
  }

  if (
    !isRecord(value) ||
    typeof value.limit !== "number" ||
    !Number.isFinite(value.limit) ||
    typeof value.remaining !== "number" ||
    !Number.isFinite(value.remaining) ||
    typeof value.resetAtMs !== "number" ||
    !Number.isFinite(value.resetAtMs)
  ) {
    throw new PlugValidationError(
      `${context} rateLimit must include limit, remaining and resetAtMs`,
    );
  }
};
