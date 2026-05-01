import { randomUUID } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

import type {
  DecodedPayloadFrame,
  PayloadFrameEnvelope,
} from "../contracts/payload-frame";
import type { PayloadFrameCompression } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { isRecord, safeStringify } from "../utils/json";

const compressionThresholdBytes = 1024;
const maxCompressedBytes = 10 * 1024 * 1024;
const maxDecodedBytes = 10 * 1024 * 1024;
const maxInflationRatio = 20;

const payloadToBuffer = (payload: PayloadFrameEnvelope["payload"]): Buffer => {
  if (typeof payload === "string") {
    return Buffer.from(payload, "base64");
  }

  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }

  if (Array.isArray(payload)) {
    return Buffer.from(payload);
  }

  throw new PlugValidationError("PayloadFrame payload must be binary or base64");
};

const assertValidFrameShape = (value: unknown): PayloadFrameEnvelope => {
  if (!isRecord(value)) {
    throw new PlugValidationError("PayloadFrame must be an object");
  }

  const frame = value as Partial<PayloadFrameEnvelope>;
  if (frame.schemaVersion !== "1.0") {
    throw new PlugValidationError("PayloadFrame schemaVersion must be 1.0");
  }
  if (frame.enc !== "json") {
    throw new PlugValidationError("PayloadFrame enc must be json");
  }
  if (frame.cmp !== "none" && frame.cmp !== "gzip") {
    throw new PlugValidationError("PayloadFrame cmp must be none or gzip");
  }
  if (frame.contentType !== "application/json") {
    throw new PlugValidationError("PayloadFrame contentType must be application/json");
  }
  if (
    typeof frame.originalSize !== "number" ||
    !Number.isInteger(frame.originalSize) ||
    frame.originalSize < 0
  ) {
    throw new PlugValidationError(
      "PayloadFrame originalSize must be a non-negative integer",
    );
  }
  if (
    typeof frame.compressedSize !== "number" ||
    !Number.isInteger(frame.compressedSize) ||
    frame.compressedSize < 0
  ) {
    throw new PlugValidationError(
      "PayloadFrame compressedSize must be a non-negative integer",
    );
  }
  if (!("payload" in frame)) {
    throw new PlugValidationError("PayloadFrame payload is required");
  }

  return frame as PayloadFrameEnvelope;
};

export const encodePayloadFrame = (
  data: unknown,
  options?: {
    readonly requestId?: string;
    readonly traceId?: string;
    readonly compression?: PayloadFrameCompression;
  },
): PayloadFrameEnvelope => {
  const json = safeStringify(data);
  const original = Buffer.from(json, "utf8");
  let cmp: PayloadFrameEnvelope["cmp"] = "none";
  let payload = original;

  const preference = options?.compression ?? "default";
  const shouldEvaluateCompression =
    preference === "always" || original.length >= compressionThresholdBytes;

  if (shouldEvaluateCompression && preference !== "none") {
    const gzip = gzipSync(original);
    if (preference === "always" || gzip.length < original.length) {
      cmp = "gzip";
      payload = gzip;
    }
  }

  if (payload.length > maxCompressedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB compressed limit");
  }

  if (original.length > maxDecodedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB decoded limit");
  }

  return {
    schemaVersion: "1.0",
    enc: "json",
    cmp,
    contentType: "application/json",
    originalSize: original.length,
    compressedSize: payload.length,
    payload,
    requestId: options?.requestId,
    traceId: options?.traceId ?? randomUUID(),
  };
};

export const decodePayloadFrame = <TData = unknown>(
  value: unknown,
): DecodedPayloadFrame<TData> => {
  const frame = assertValidFrameShape(value);
  const compressedBytes = payloadToBuffer(frame.payload);

  if (compressedBytes.length !== frame.compressedSize) {
    throw new PlugValidationError(
      "PayloadFrame compressedSize does not match payload length",
    );
  }

  if (compressedBytes.length > maxCompressedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB compressed limit");
  }

  const decodedBytes =
    frame.cmp === "gzip" ? gunzipSync(compressedBytes) : compressedBytes;

  if (decodedBytes.length !== frame.originalSize) {
    throw new PlugValidationError(
      "PayloadFrame originalSize does not match decoded payload length",
    );
  }

  if (decodedBytes.length > maxDecodedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB decoded limit");
  }

  if (
    frame.cmp === "gzip" &&
    compressedBytes.length > 0 &&
    decodedBytes.length / compressedBytes.length > maxInflationRatio
  ) {
    throw new PlugValidationError(
      "PayloadFrame exceeded the allowed gzip inflation ratio",
    );
  }

  let parsed: TData;
  try {
    parsed = JSON.parse(decodedBytes.toString("utf8")) as TData;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON payload";
    throw new PlugValidationError("PayloadFrame contains invalid JSON", {
      technicalMessage: message,
    });
  }

  return {
    frame,
    bytes: decodedBytes,
    data: parsed,
  };
};
