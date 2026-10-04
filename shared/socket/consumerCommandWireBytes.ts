import { estimateJsonUtf8Bytes, isRecord } from "../utils/json";

const measuredBytes = new WeakMap<object, number>();

export const rememberConsumerWireBytes = (payload: unknown, bytes: number): void => {
  if (typeof payload === "object" && payload !== null) measuredBytes.set(payload, bytes);
};

const isPayloadFrameEnvelope = (
  payload: unknown,
): payload is { readonly originalSize?: number } =>
  isRecord(payload) &&
  payload.schemaVersion === "1.0" &&
  payload.enc === "json" &&
  typeof payload.originalSize === "number" &&
  Number.isInteger(payload.originalSize) &&
  payload.originalSize >= 0;

/** Prefer hub-reported PayloadFrame originalSize over JSON.stringify on hot paths. */
export const estimateConsumerWireBytes = (
  wirePayload: unknown,
  decodedData?: unknown,
): number => {
  if (typeof wirePayload === "object" && wirePayload !== null) {
    const cached = measuredBytes.get(wirePayload);
    if (cached !== undefined) return cached;
  }
  if (isPayloadFrameEnvelope(wirePayload)) {
    return wirePayload.originalSize as number;
  }

  const bytes = estimateJsonUtf8Bytes(decodedData ?? wirePayload);
  rememberConsumerWireBytes(wirePayload, bytes);
  return bytes;
};
