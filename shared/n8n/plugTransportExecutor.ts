import type {
  BuiltCommandRequest,
  JsonObject,
  PlugCommandTransportResult,
  PlugCredentialDefaults,
  PlugTransportExecutionMetrics,
} from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import type { PlugExecutionSessionRunner } from "../auth/session";
import { executeRestCommand } from "../rest/client";
import { buildNodeOutputItems } from "../output/nodeOutput";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";
import { resolvePayloadFrameSigning } from "./payloadFrameSigning";
import { rotateBuiltRequestCommandIdsForRetry } from "./plugCommandIdRotation";
import {
  computeRetryDelayMs,
  isReplayDetectedPlugError,
  MAX_TRANSIENT_RETRIES,
  shouldRetryPlugOperation,
  sleepMs,
} from "./plugTransientRetry";

const executeBuiltRequest = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: PlugExecutionSessionRunner<PlugCredentialDefaults>,
  builtRequest: BuiltCommandRequest,
  config: PlugClientNodeExecutionConfig,
): Promise<PlugCommandTransportResult> =>
  sessionRunner(async (session) => {
    if (builtRequest.channel === "socket") {
      const socketImplementation = builtRequest.socketImplementation ?? "relay";
      const socketExecutor =
        socketImplementation === "relay"
          ? (config.legacySocketExecutor ?? config.socketExecutor)
          : config.socketExecutor;

      if (!config.supportsSocket || !socketExecutor) {
        throw new PlugValidationError(
          "This package does not support the socket channel.",
        );
      }

      return socketExecutor({
        session,
        agentId: builtRequest.agentId,
        command: builtRequest.command,
        timeoutMs: builtRequest.timeoutMs,
        payloadFrameCompression: builtRequest.payloadFrameCompression,
        payloadFrameSigning: resolvePayloadFrameSigning(session.credentials),
        responseMode: builtRequest.responseMode,
        bufferLimits: builtRequest.bufferLimits,
        ...(builtRequest.streamPullWindowSize !== undefined
          ? { streamPullWindowSize: builtRequest.streamPullWindowSize }
          : {}),
        ...(builtRequest.fastPath === true ? { fastPath: true as const } : {}),
        ...(builtRequest.requestServerTimings === true
          ? { requestServerTimings: true as const }
          : {}),
      });
    }

    return executeRestCommand(requester, session, builtRequest);
  });

const attachTransportExecutionMetrics = (
  transportResult: PlugCommandTransportResult,
  executionMetrics: PlugTransportExecutionMetrics,
): PlugCommandTransportResult => {
  if (transportResult.notification) {
    return transportResult;
  }

  if (transportResult.channel === "rest") {
    return {
      ...transportResult,
      executionMetrics: {
        ...transportResult.executionMetrics,
        ...executionMetrics,
      },
    };
  }

  return {
    ...transportResult,
    executionMetrics: {
      ...transportResult.executionMetrics,
      ...executionMetrics,
      connectedAfterMs:
        transportResult.executionMetrics?.connectedAfterMs ??
        executionMetrics.connectedAfterMs,
      serverTimings:
        transportResult.executionMetrics?.serverTimings ?? executionMetrics.serverTimings,
    },
  };
};

export const executeBuiltCommandWithRetry = async (input: {
  readonly builtRequest: BuiltCommandRequest;
  readonly requester: import("../contracts/api").PlugHttpRequester;
  readonly sessionRunner: PlugExecutionSessionRunner<PlugCredentialDefaults>;
  readonly config: PlugClientNodeExecutionConfig;
  readonly includeMetadata: boolean;
}): Promise<{
  readonly transportResult: PlugCommandTransportResult;
  readonly jsonItems: JsonObject[];
  readonly attemptCount: number;
  readonly lastRetryDelayMs?: number;
}> => {
  let lastRetryDelayMs: number | undefined;

  for (
    let attemptNumber = 0;
    attemptNumber <= MAX_TRANSIENT_RETRIES;
    attemptNumber += 1
  ) {
    const builtRequest = rotateBuiltRequestCommandIdsForRetry(
      input.builtRequest,
      attemptNumber,
    );

    try {
      const transportResult = await executeBuiltRequest(
        input.requester,
        input.sessionRunner,
        builtRequest,
        input.config,
      );
      const executionMetrics: PlugTransportExecutionMetrics = {
        attemptCount: attemptNumber + 1,
        lastRetryDelayMs,
        connectedAfterMs:
          transportResult.channel === "socket" && !transportResult.notification
            ? transportResult.executionMetrics?.connectedAfterMs
            : undefined,
        serverTimings: !transportResult.notification
          ? transportResult.executionMetrics?.serverTimings
          : undefined,
      };
      const transportWithMetrics = attachTransportExecutionMetrics(
        transportResult,
        executionMetrics,
      );
      const jsonItems = buildNodeOutputItems(
        transportWithMetrics,
        builtRequest.responseMode,
        input.includeMetadata,
      );

      return {
        transportResult: transportWithMetrics,
        jsonItems,
        attemptCount: attemptNumber + 1,
        lastRetryDelayMs,
      };
    } catch (error: unknown) {
      if (isReplayDetectedPlugError(error)) {
        throw error;
      }

      if (
        !shouldRetryPlugOperation({
          operation: builtRequest.operation,
          error,
          attemptNumber,
        })
      ) {
        throw error;
      }

      const delayMs =
        error instanceof PlugError
          ? computeRetryDelayMs(error, attemptNumber)
          : computeRetryDelayMs(
              new PlugError("Plug request timed out before completion.", {
                code: "PLUG_TIMEOUT",
                retryable: true,
              }),
              attemptNumber,
            );
      lastRetryDelayMs = delayMs;
      await sleepMs(delayMs);
    }
  }

  throw new PlugValidationError("Plug request finished without a successful attempt");
};
