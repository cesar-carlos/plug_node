import { randomUUID } from "node:crypto";

import type {
  PlugServerTimings,
  RelayConnectionReadyPayload,
  RelayConversationStartedPayload,
  RelayRpcAcceptedPayload,
  RelayRpcAcceptedSuccessPayload,
  RelayRpcBatchAcceptedPayload,
  RelayRpcBatchAcceptedItem,
  RelayStreamPullResponsePayload,
  RpcSingleCommand,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";
import { createRelayControlError } from "./relaySessionErrors";

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const isPositiveInteger = (value: unknown): value is number =>
  typeof value === "number" &&
  Number.isInteger(value) &&
  Number.isFinite(value) &&
  value > 0;

export const normalizeRelayConnectionReady = (
  payload: unknown,
  signing?: PayloadFrameSigningOptions,
): Promise<RelayConnectionReadyPayload> =>
  decodePayloadFrameAsync<RelayConnectionReadyPayload>(payload, { signing }).then(
    (decoded) => decoded.data,
  );

export const normalizeRelayConversationStarted = (
  payload: unknown,
): RelayConversationStartedPayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError(
      "relay:conversation.started must be an object with a success boolean",
    );
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:conversation.started success payload must include conversationId",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:conversation.started failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayConversationStartedPayload;
};

export const normalizeRelayAcceptedPayload = (
  payload: unknown,
): RelayRpcAcceptedPayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError("relay:rpc.accepted must include success boolean");
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:rpc.accepted success payload must include conversationId",
      );
    }
    if (!isNonEmptyString(payload.requestId)) {
      throw new PlugValidationError(
        "relay:rpc.accepted success payload must include requestId",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:rpc.accepted failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayRpcAcceptedPayload;
};

export const normalizeRelayStreamPullResponse = (
  payload: unknown,
): RelayStreamPullResponsePayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError(
      "relay:rpc.stream.pull_response must include success boolean",
    );
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include conversationId",
      );
    }
    if (!isNonEmptyString(payload.requestId)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include requestId",
      );
    }
    if (!isNonEmptyString(payload.streamId)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include streamId",
      );
    }
    if (!isPositiveInteger(payload.windowSize)) {
      throw new PlugValidationError(
        "relay:rpc.stream.pull_response success payload must include a positive windowSize",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:rpc.stream.pull_response failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayStreamPullResponsePayload;
};

export const assertRelayAcceptedPayload = (
  payload: RelayRpcAcceptedPayload,
): RelayRpcAcceptedSuccessPayload => {
  if (payload.success) {
    return payload;
  }

  throw createRelayControlError({
    code: payload.error.code,
    message: payload.error.message,
    statusCode: payload.error.statusCode,
    retryAfterMs: payload.error.retryAfterMs,
  });
};

export const ensureRelayCompatibleCommand = (
  command: RpcSingleCommand,
): RpcSingleCommand => {
  if (command.id === null) {
    throw new PlugValidationError(
      "Socket relay does not support JSON-RPC notifications (`id: null`)",
    );
  }

  return {
    ...command,
    id: command.id ?? randomUUID(),
  };
};

export const getStreamIdFromNormalizedResponse = (
  payload: unknown,
): string | undefined => {
  if (!isRecord(payload) || !isRecord(payload.result)) {
    return undefined;
  }

  return typeof payload.result.stream_id === "string" &&
    payload.result.stream_id.trim() !== ""
    ? payload.result.stream_id
    : undefined;
};

export const normalizeRelayStreamPullWindowSize = (
  value: unknown,
  fallback: number,
  maxWindowSize: number,
): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return fallback;
  }

  return Math.min(maxWindowSize, Math.max(1, Math.floor(value)));
};

const isBatchAcceptedItem = (value: unknown): value is RelayRpcBatchAcceptedItem => {
  if (!isRecord(value) || !isNonEmptyString(value.clientRequestId)) {
    return false;
  }

  if (isNonEmptyString(value.requestId)) {
    return true;
  }

  return (
    isRecord(value.error) &&
    isNonEmptyString(value.error.code) &&
    isNonEmptyString(value.error.message)
  );
};

export const normalizeRelayBatchAcceptedPayload = (
  payload: unknown,
): RelayRpcBatchAcceptedPayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError(
      "relay:rpc.batch_accepted must include success boolean",
    );
  }

  if (payload.success) {
    if (!isNonEmptyString(payload.conversationId)) {
      throw new PlugValidationError(
        "relay:rpc.batch_accepted success payload must include conversationId",
      );
    }
    if (!isPositiveInteger(payload.batchSize)) {
      throw new PlugValidationError(
        "relay:rpc.batch_accepted success payload must include batchSize",
      );
    }
    if (!Array.isArray(payload.items) || !payload.items.every(isBatchAcceptedItem)) {
      throw new PlugValidationError(
        "relay:rpc.batch_accepted success payload must include items[]",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    !isNonEmptyString(payload.error.code) ||
    !isNonEmptyString(payload.error.message)
  ) {
    throw new PlugValidationError(
      "relay:rpc.batch_accepted failure payload must include error.code and error.message",
    );
  }

  return payload as unknown as RelayRpcBatchAcceptedPayload;
};

export const assertRelayBatchAcceptedPayload = (
  payload: RelayRpcBatchAcceptedPayload,
): RelayRpcBatchAcceptedPayload & { readonly success: true } => {
  if (payload.success) {
    return payload;
  }

  throw createRelayControlError({
    code: payload.error.code,
    message: payload.error.message,
    statusCode: payload.error.statusCode,
    details: payload.error.details,
  });
};

export const extractServerTimings = (payload: unknown): PlugServerTimings | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  const direct = payload.serverTimings;
  if (isRecord(direct) && isRecord(direct.phasesMs)) {
    return direct as unknown as PlugServerTimings;
  }

  const meta = payload.meta;
  if (
    isRecord(meta) &&
    isRecord(meta.serverTimings) &&
    isRecord(meta.serverTimings.phasesMs)
  ) {
    return meta.serverTimings as unknown as PlugServerTimings;
  }

  const response = payload.response;
  if (
    isRecord(response) &&
    isRecord(response.meta) &&
    isRecord(response.meta.serverTimings) &&
    isRecord(response.meta.serverTimings.phasesMs)
  ) {
    return response.meta.serverTimings as unknown as PlugServerTimings;
  }

  return undefined;
};

export const extractRpcBodyId = (payload: unknown): string | undefined => {
  if (!isRecord(payload)) {
    return undefined;
  }

  if (payload.id === null || payload.id === undefined) {
    return undefined;
  }

  if (typeof payload.id === "string" && payload.id.trim() !== "") {
    return payload.id;
  }

  if (typeof payload.id === "number" && Number.isFinite(payload.id)) {
    return String(payload.id);
  }

  return undefined;
};
