import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { promisify } from "node:util";
import {
  gunzip as gunzipCallback,
  gunzipSync,
  gzip as gzipCallback,
  gzipSync,
} from "node:zlib";

import type {
  DecodedPayloadFrame,
  PayloadFrameEnvelope,
  PayloadFrameSigningOptions,
} from "../contracts/payload-frame";
import type { PayloadFrameCompression } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { isRecord, stringifyJson } from "../utils/json";

const compressionThresholdBytes = 1024;
const minAutoGzipSavingsBytes = 64;
const maxGzipInputBytes = 512 * 1024;
const maxCompressedBytes = 10 * 1024 * 1024;
const maxDecodedBytes = 10 * 1024 * 1024;
const maxInflationRatio = 20;
const asyncGzipThresholdBytes = 128 * 1024;
const asyncGunzipThresholdBytes = 64 * 1024;
const signatureAlgorithm = "hmac-sha256";
const gzipAsync = promisify(gzipCallback);
const allowedRootKeys = new Set([
  "schemaVersion",
  "enc",
  "cmp",
  "contentType",
  "originalSize",
  "compressedSize",
  "payload",
  "traceId",
  "requestId",
  "signature",
]);
const allowedSignatureKeys = new Set(["alg", "value", "key_id"]);

const payloadToBuffer = (payload: PayloadFrameEnvelope["payload"]): Buffer => {
  if (typeof payload === "string") {
    return Buffer.from(payload, "base64");
  }

  if (payload instanceof Uint8Array) {
    return Buffer.from(payload);
  }

  if (Array.isArray(payload)) {
    for (const value of payload) {
      if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new PlugValidationError(
          "PayloadFrame payload array must contain byte values",
        );
      }
    }
    return Buffer.from(payload);
  }

  throw new PlugValidationError("PayloadFrame payload must be binary or base64");
};

const assertValidFrameShape = (value: unknown): PayloadFrameEnvelope => {
  if (!isRecord(value)) {
    throw new PlugValidationError("PayloadFrame must be an object");
  }

  const frame = value as Partial<PayloadFrameEnvelope>;
  for (const key of Object.keys(frame)) {
    if (!allowedRootKeys.has(key)) {
      throw new PlugValidationError("PayloadFrame contains unsupported fields");
    }
  }

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
  if (frame.traceId !== undefined && typeof frame.traceId !== "string") {
    throw new PlugValidationError("PayloadFrame traceId must be a string");
  }
  if (
    frame.requestId !== undefined &&
    frame.requestId !== null &&
    typeof frame.requestId !== "string"
  ) {
    throw new PlugValidationError("PayloadFrame requestId must be a string or null");
  }
  if (frame.signature !== undefined) {
    if (!isRecord(frame.signature)) {
      throw new PlugValidationError("PayloadFrame signature must be an object");
    }
    const signature = frame.signature as Record<string, unknown>;
    for (const key of Object.keys(signature)) {
      if (!allowedSignatureKeys.has(key)) {
        throw new PlugValidationError(
          "PayloadFrame signature contains unsupported fields",
        );
      }
    }
    if (signature.alg !== signatureAlgorithm) {
      throw new PlugValidationError("PayloadFrame signature alg must be hmac-sha256");
    }
    if (typeof signature.value !== "string" || signature.value.trim() === "") {
      throw new PlugValidationError("PayloadFrame signature value is required");
    }
    if (signature.key_id !== undefined && typeof signature.key_id !== "string") {
      throw new PlugValidationError("PayloadFrame signature key_id must be a string");
    }
  }

  return frame as PayloadFrameEnvelope;
};

const normalizeSigningKey = (
  options?: PayloadFrameSigningOptions,
): string | undefined => {
  const key = options?.key;
  return typeof key === "string" && key.trim() !== "" ? key : undefined;
};

const buildSignatureInput = (
  frame: PayloadFrameEnvelope,
  binaryPayload: Buffer,
): Buffer => {
  const metadata = JSON.stringify({
    schemaVersion: frame.schemaVersion,
    enc: frame.enc,
    cmp: frame.cmp,
    contentType: frame.contentType,
    originalSize: frame.originalSize,
    compressedSize: frame.compressedSize,
    traceId: frame.traceId ?? null,
    requestId: frame.requestId ?? null,
  });

  return Buffer.concat([Buffer.from(metadata, "utf8"), Buffer.from([0]), binaryPayload]);
};

const signFrame = (
  frame: PayloadFrameEnvelope,
  binaryPayload: Buffer,
  signing: PayloadFrameSigningOptions | undefined,
): PayloadFrameEnvelope => {
  const key = normalizeSigningKey(signing);
  if (!key) {
    return frame;
  }

  const value = createHmac("sha256", key)
    .update(buildSignatureInput(frame, binaryPayload))
    .digest("base64");

  return {
    ...frame,
    signature: {
      alg: signatureAlgorithm,
      value,
      ...(signing?.keyId && signing.keyId.trim() !== "" ? { key_id: signing.keyId } : {}),
    },
  };
};

const shouldEvaluateCompression = (
  originalLength: number,
  preference: PayloadFrameCompression,
): boolean =>
  preference === "always"
    ? originalLength >= 1
    : originalLength >= compressionThresholdBytes;

const shouldUseCompressedPayload = (
  originalLength: number,
  compressedLength: number,
  preference: PayloadFrameCompression,
): boolean =>
  preference === "always" || originalLength - compressedLength >= minAutoGzipSavingsBytes;

const assertPayloadSizeLimits = (payloadLength: number, originalLength: number): void => {
  if (payloadLength > maxCompressedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB compressed limit");
  }

  if (originalLength > maxDecodedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB decoded limit");
  }
};

const assertDecodedMetadataLimits = (
  frame: PayloadFrameEnvelope,
  compressedLength: number,
): void => {
  if (frame.originalSize > maxDecodedBytes) {
    throw new PlugValidationError("PayloadFrame exceeds the 10 MiB decoded limit");
  }

  if (
    frame.cmp === "gzip" &&
    compressedLength > 0 &&
    frame.originalSize / compressedLength > maxInflationRatio
  ) {
    throw new PlugValidationError(
      "PayloadFrame exceeded the allowed gzip inflation ratio",
    );
  }
};

const gunzipWithLimitSync = (compressedBytes: Buffer): Buffer => {
  try {
    return gunzipSync(compressedBytes, { maxOutputLength: maxDecodedBytes });
  } catch (error: unknown) {
    if (
      isRecord(error) &&
      (error.code === "ERR_BUFFER_TOO_LARGE" ||
        String(error.message ?? "").includes("maxOutputLength"))
    ) {
      throw new PlugValidationError("PayloadFrame exceeds the 10 MiB decoded limit");
    }

    throw error;
  }
};

const gunzipWithLimitAsync = async (compressedBytes: Buffer): Promise<Buffer> =>
  new Promise<Buffer>((resolve, reject) => {
    gunzipCallback(
      compressedBytes,
      { maxOutputLength: maxDecodedBytes },
      (error, result) => {
        if (error) {
          if (
            isRecord(error) &&
            (error.code === "ERR_BUFFER_TOO_LARGE" ||
              String(error.message ?? "").includes("maxOutputLength"))
          ) {
            reject(
              new PlugValidationError("PayloadFrame exceeds the 10 MiB decoded limit"),
            );
            return;
          }

          reject(error);
          return;
        }

        resolve(result);
      },
    );
  });

const buildFrame = (
  payload: Buffer,
  originalLength: number,
  cmp: PayloadFrameEnvelope["cmp"],
  options?: {
    readonly requestId?: string;
    readonly traceId?: string;
    readonly omitTraceId?: boolean;
    readonly signing?: PayloadFrameSigningOptions;
  },
): PayloadFrameEnvelope => {
  const traceFields =
    options?.traceId !== undefined
      ? { traceId: options.traceId }
      : options?.omitTraceId === true
        ? {}
        : { traceId: randomUUID() };

  const frame: PayloadFrameEnvelope = {
    schemaVersion: "1.0",
    enc: "json",
    cmp,
    contentType: "application/json",
    originalSize: originalLength,
    compressedSize: payload.length,
    payload,
    requestId: options?.requestId,
    ...traceFields,
  };

  return signFrame(frame, payload, options?.signing);
};

const preparePayloadSync = (
  original: Buffer,
  preference: PayloadFrameCompression,
): {
  readonly cmp: PayloadFrameEnvelope["cmp"];
  readonly payload: Buffer;
} => {
  if (
    shouldEvaluateCompression(original.length, preference) &&
    preference !== "none" &&
    original.length <= maxGzipInputBytes
  ) {
    const gzip = gzipSync(original);
    if (shouldUseCompressedPayload(original.length, gzip.length, preference)) {
      return { cmp: "gzip", payload: gzip };
    }
  }

  return { cmp: "none", payload: original };
};

const preparePayloadAsync = async (
  original: Buffer,
  preference: PayloadFrameCompression,
): Promise<{
  readonly cmp: PayloadFrameEnvelope["cmp"];
  readonly payload: Buffer;
}> => {
  if (
    shouldEvaluateCompression(original.length, preference) &&
    preference !== "none" &&
    original.length <= maxGzipInputBytes
  ) {
    const gzip =
      original.length >= asyncGzipThresholdBytes
        ? await gzipAsync(original)
        : gzipSync(original);
    if (shouldUseCompressedPayload(original.length, gzip.length, preference)) {
      return { cmp: "gzip", payload: gzip };
    }
  }

  return { cmp: "none", payload: original };
};

const parseDecodedPayload = <TData>(decodedBytes: Buffer): TData => {
  try {
    return JSON.parse(decodedBytes.toString("utf8")) as TData;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid JSON payload";
    throw new PlugValidationError("PayloadFrame contains invalid JSON", {
      technicalMessage: message,
    });
  }
};

const validateDecodedPayload = (
  frame: PayloadFrameEnvelope,
  compressedBytes: Buffer,
  decodedBytes: Buffer,
  validateSignature:
    | ((input: {
        readonly frame: PayloadFrameEnvelope;
        readonly compressedBytes: Buffer;
        readonly decodedBytes: Buffer;
      }) => void)
    | undefined,
): void => {
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

  validateSignature?.({
    frame,
    compressedBytes,
    decodedBytes,
  });
};

const parseFrameForDecode = (
  value: unknown,
  signing: PayloadFrameSigningOptions | undefined,
): {
  readonly frame: PayloadFrameEnvelope;
  readonly compressedBytes: Buffer;
} => {
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

  verifyFrameSignature(frame, compressedBytes, signing);
  assertDecodedMetadataLimits(frame, compressedBytes.length);

  return { frame, compressedBytes };
};

const verifyFrameSignature = (
  frame: PayloadFrameEnvelope,
  binaryPayload: Buffer,
  signing: PayloadFrameSigningOptions | undefined,
): void => {
  if (frame.signature === undefined) {
    if (signing?.requireSignature === true) {
      throw new PlugValidationError("PayloadFrame signature is required");
    }
    return;
  }

  const key = normalizeSigningKey(signing);
  if (!key) {
    throw new PlugValidationError(
      "PayloadFrame signature is present but no signing key is configured",
    );
  }

  if (
    signing?.keyId !== undefined &&
    signing.keyId.trim() !== "" &&
    (frame.signature.key_id === undefined ||
      frame.signature.key_id.trim() === "" ||
      frame.signature.key_id !== signing.keyId)
  ) {
    throw new PlugValidationError("PayloadFrame signature key_id mismatch");
  }

  const expected = createHmac("sha256", key)
    .update(buildSignatureInput(frame, binaryPayload))
    .digest("base64");
  const provided = frame.signature.value.trim();
  if (provided === "") {
    throw new PlugValidationError("PayloadFrame signature value is required");
  }
  const expectedBytes = Buffer.from(expected, "utf8");
  const providedBytes = Buffer.from(provided, "utf8");

  if (
    providedBytes.length !== expectedBytes.length ||
    !timingSafeEqual(providedBytes, expectedBytes)
  ) {
    throw new PlugValidationError("PayloadFrame signature verification failed");
  }
};

export const encodePayloadFrame = (
  data: unknown,
  options?: {
    readonly requestId?: string;
    readonly traceId?: string;
    readonly omitTraceId?: boolean;
    readonly compression?: PayloadFrameCompression;
    readonly signing?: PayloadFrameSigningOptions;
  },
): PayloadFrameEnvelope => {
  const json = stringifyJson(data);
  const original = Buffer.from(json, "utf8");
  const preference = options?.compression ?? "default";
  const { cmp, payload } = preparePayloadSync(original, preference);
  assertPayloadSizeLimits(payload.length, original.length);

  return buildFrame(payload, original.length, cmp, options);
};

export const encodePayloadFrameAsync = async (
  data: unknown,
  options?: {
    readonly requestId?: string;
    readonly traceId?: string;
    readonly omitTraceId?: boolean;
    readonly compression?: PayloadFrameCompression;
    readonly signing?: PayloadFrameSigningOptions;
  },
): Promise<PayloadFrameEnvelope> => {
  const json = stringifyJson(data);
  const original = Buffer.from(json, "utf8");
  const preference = options?.compression ?? "default";
  const { cmp, payload } = await preparePayloadAsync(original, preference);
  assertPayloadSizeLimits(payload.length, original.length);

  return buildFrame(payload, original.length, cmp, options);
};

export const decodePayloadFrame = <TData = unknown>(
  value: unknown,
  options?: {
    readonly validateSignature?: (input: {
      readonly frame: PayloadFrameEnvelope;
      readonly compressedBytes: Buffer;
      readonly decodedBytes: Buffer;
    }) => void;
    readonly signing?: PayloadFrameSigningOptions;
  },
): DecodedPayloadFrame<TData> => {
  const { frame, compressedBytes } = parseFrameForDecode(value, options?.signing);

  const decodedBytes =
    frame.cmp === "gzip" ? gunzipWithLimitSync(compressedBytes) : compressedBytes;

  validateDecodedPayload(
    frame,
    compressedBytes,
    decodedBytes,
    options?.validateSignature,
  );

  return { frame, bytes: decodedBytes, data: parseDecodedPayload<TData>(decodedBytes) };
};

export const decodePayloadFrameAsync = async <TData = unknown>(
  value: unknown,
  options?: {
    readonly validateSignature?: (input: {
      readonly frame: PayloadFrameEnvelope;
      readonly compressedBytes: Buffer;
      readonly decodedBytes: Buffer;
    }) => void;
    readonly signing?: PayloadFrameSigningOptions;
  },
): Promise<DecodedPayloadFrame<TData>> => {
  const { frame, compressedBytes } = parseFrameForDecode(value, options?.signing);

  const decodedBytes =
    frame.cmp === "gzip"
      ? compressedBytes.length >= asyncGunzipThresholdBytes
        ? await gunzipWithLimitAsync(compressedBytes)
        : gunzipWithLimitSync(compressedBytes)
      : compressedBytes;

  validateDecodedPayload(
    frame,
    compressedBytes,
    decodedBytes,
    options?.validateSignature,
  );

  return { frame, bytes: decodedBytes, data: parseDecodedPayload<TData>(decodedBytes) };
};
