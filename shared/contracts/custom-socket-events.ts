import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type JsonObject,
  type PayloadFrameCompression,
} from "./api";
import { PlugValidationError } from "./errors";
import { isRecord } from "../utils/json";

export const customSocketEventPrefix = "client:custom." as const;
export const customSocketEventNameMaxLength = 128;
export const defaultSocketEventAckTimeoutMs = 10_000;
export const defaultManualListenTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
export const defaultBinaryPropertyPrefix = "attachment";

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
  readonly timeoutMs?: number;
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

    if (value.rateLimit !== undefined) {
      if (
        !isRecord(value.rateLimit) ||
        typeof value.rateLimit.limit !== "number" ||
        !Number.isFinite(value.rateLimit.limit) ||
        typeof value.rateLimit.remaining !== "number" ||
        !Number.isFinite(value.rateLimit.remaining) ||
        typeof value.rateLimit.resetAtMs !== "number" ||
        !Number.isFinite(value.rateLimit.resetAtMs)
      ) {
        throw new PlugValidationError(
          "socket:event ack failure rateLimit must include limit, remaining and resetAtMs",
        );
      }
    }
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
  if (typeof value.emittedAt !== "string" || value.emittedAt.trim() === "") {
    throw new PlugValidationError("Custom socket event payload is missing emittedAt");
  }

  if (!isRecord(value.publisher)) {
    throw new PlugValidationError("Custom socket event payload is missing publisher");
  }

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
