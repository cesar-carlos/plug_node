import { estimateJsonUtf8Bytes, isRecord } from "../utils/json";

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
  if (isPayloadFrameEnvelope(wirePayload)) {
    return wirePayload.originalSize as number;
  }

  return estimateJsonUtf8Bytes(decodedData ?? wirePayload);
};
