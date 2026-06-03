import { randomUUID } from "node:crypto";

import type {
  BridgeCommand,
  ConsumerCommandNotificationResponse,
  ConsumerCommandSocketResponsePayload,
  ConsumerCommandStreamChunkPayload,
  ConsumerCommandStreamCompletePayload,
  ConsumerCommandStreamPullResponsePayload,
  RelayConnectionReadyPayload,
  RpcSingleCommand,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import { PlugValidationError } from "../contracts/errors";
import { decodePayloadFrameAsync } from "./payloadFrameCodec";
import { isRecord } from "../utils/json";

const isPayloadFrameEnvelope = (payload: unknown): boolean =>
  isRecord(payload) && payload.schemaVersion === "1.0" && payload.enc === "json";

export const decodeConsumerCommandWirePayload = async <T>(
  payload: unknown,
  signing?: PayloadFrameSigningOptions,
): Promise<T> => {
  if (!isPayloadFrameEnvelope(payload)) {
    return payload as T;
  }

  const decoded = await decodePayloadFrameAsync<T>(payload, { signing });
  return decoded.data;
};

export const normalizeConsumerConnectionReady = (
  payload: unknown,
  signing?: PayloadFrameSigningOptions,
): Promise<RelayConnectionReadyPayload> =>
  decodePayloadFrameAsync<RelayConnectionReadyPayload>(payload, { signing }).then(
    (decoded) => decoded.data,
  );

export const normalizeConsumerCommandResponse = (
  payload: unknown,
): ConsumerCommandSocketResponsePayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError("agents:command_response must be an object");
  }

  if (payload.success) {
    if (typeof payload.requestId !== "string" || payload.requestId.trim() === "") {
      throw new PlugValidationError(
        "agents:command_response success payload must include requestId",
      );
    }

    if (!("response" in payload)) {
      throw new PlugValidationError(
        "agents:command_response success payload must include response",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    typeof payload.error.code !== "string" ||
    typeof payload.error.message !== "string"
  ) {
    throw new PlugValidationError(
      "agents:command_response failure payload must include error.code and error.message",
    );
  }

  if (
    payload.clientRequestId !== undefined &&
    (typeof payload.clientRequestId !== "string" || payload.clientRequestId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_response clientRequestId must be a non-empty string",
    );
  }

  if (
    payload.requestId !== undefined &&
    (typeof payload.requestId !== "string" || payload.requestId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_response requestId must be a non-empty string",
    );
  }

  if (
    payload.streamId !== undefined &&
    (typeof payload.streamId !== "string" || payload.streamId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_response streamId must be a non-empty string",
    );
  }

  return payload as unknown as ConsumerCommandSocketResponsePayload;
};

export const normalizeConsumerStreamChunkPayload = (
  payload: unknown,
): ConsumerCommandStreamChunkPayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("agents:command_stream_chunk must be an object");
  }

  if (
    payload.stream_id !== undefined &&
    (typeof payload.stream_id !== "string" || payload.stream_id.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_stream_chunk stream_id must be a non-empty string when present",
    );
  }

  return payload as ConsumerCommandStreamChunkPayload;
};

export const normalizeConsumerStreamCompletePayload = (
  payload: unknown,
): ConsumerCommandStreamCompletePayload => {
  if (!isRecord(payload)) {
    throw new PlugValidationError("agents:command_stream_complete must be an object");
  }

  if (
    payload.stream_id !== undefined &&
    (typeof payload.stream_id !== "string" || payload.stream_id.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:command_stream_complete stream_id must be a non-empty string when present",
    );
  }

  if (
    payload.terminal_status !== undefined &&
    typeof payload.terminal_status !== "string"
  ) {
    throw new PlugValidationError(
      "agents:command_stream_complete terminal_status must be a string when present",
    );
  }

  return payload as ConsumerCommandStreamCompletePayload;
};

export const normalizeConsumerStreamPullResponse = (
  payload: unknown,
): ConsumerCommandStreamPullResponsePayload => {
  if (!isRecord(payload) || typeof payload.success !== "boolean") {
    throw new PlugValidationError("agents:stream_pull_response must be an object");
  }

  if (payload.success) {
    if (typeof payload.requestId !== "string" || payload.requestId.trim() === "") {
      throw new PlugValidationError(
        "agents:stream_pull_response success payload must include requestId",
      );
    }
    if (typeof payload.streamId !== "string" || payload.streamId.trim() === "") {
      throw new PlugValidationError(
        "agents:stream_pull_response success payload must include streamId",
      );
    }
    if (
      typeof payload.windowSize !== "number" ||
      !Number.isInteger(payload.windowSize) ||
      payload.windowSize <= 0
    ) {
      throw new PlugValidationError(
        "agents:stream_pull_response success payload must include a positive windowSize",
      );
    }
  } else if (
    !isRecord(payload.error) ||
    typeof payload.error.code !== "string" ||
    typeof payload.error.message !== "string"
  ) {
    throw new PlugValidationError(
      "agents:stream_pull_response failure payload must include error.code and error.message",
    );
  }

  if (
    payload.requestId !== undefined &&
    (typeof payload.requestId !== "string" || payload.requestId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:stream_pull_response requestId must be a non-empty string",
    );
  }

  if (
    payload.streamId !== undefined &&
    (typeof payload.streamId !== "string" || payload.streamId.trim() === "")
  ) {
    throw new PlugValidationError(
      "agents:stream_pull_response streamId must be a non-empty string",
    );
  }

  return payload as unknown as ConsumerCommandStreamPullResponsePayload;
};

export const toConsumerCommandRequestId = (value: unknown): string | undefined => {
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return undefined;
};

export const resolveConsumerCommandRequestId = (command: BridgeCommand): string => {
  if (Array.isArray(command)) {
    return randomUUID();
  }

  return toConsumerCommandRequestId(command.id) ?? randomUUID();
};

export const withConsumerCommandRequestId = (
  command: BridgeCommand,
  requestId: string,
): BridgeCommand => {
  if (Array.isArray(command) || command.id !== undefined) {
    return command;
  }

  return {
    ...command,
    id: requestId,
  } as RpcSingleCommand;
};

export const isConsumerNotificationResponse = (
  value: unknown,
): value is ConsumerCommandNotificationResponse =>
  isRecord(value) &&
  value.type === "notification" &&
  typeof value.accepted === "boolean" &&
  typeof value.acceptedCommands === "number";
