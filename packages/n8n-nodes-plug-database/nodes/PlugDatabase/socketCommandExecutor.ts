import { randomUUID } from "node:crypto";

import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PlugSocketImplementation,
} from "../../generated/shared/contracts/api";
import {
  PlugError,
  PlugTimeoutError,
  PlugValidationError,
} from "../../generated/shared/contracts/errors";
import { plugLogger } from "../../generated/shared/logging/plugLogger";
import {
  buildConsumerSocketCapabilityProbeCommand,
  executeConsumerCommand,
  type ConsumerSocketTransport,
} from "../../generated/shared/socket/consumerCommandSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";
import {
  extractMaxStreamPullWindowSize,
  extractRecommendedStreamPullWindowSize,
} from "../../generated/shared/socket/streamPullWindowPolicy";
import { createManagedSocketIoTransport } from "./managedSocketIoTransport";

const defaultCapabilityProbeTimeoutMs = 1_500;
const capabilityTtlMs = 60_000;
const capabilityProbeBackoffMinMs = 50;
const capabilityProbeBackoffJitterMs = 100;

const sleep = async (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const nextProbeBackoffMs = (): number =>
  capabilityProbeBackoffMinMs +
  Math.floor(Math.random() * capabilityProbeBackoffJitterMs);

const buildRelayFallbackInput = (
  input: Parameters<PlugSocketExecutor>[0],
): Parameters<PlugSocketExecutor>[0] => {
  if (Array.isArray(input.command)) {
    return input;
  }

  return {
    ...input,
    command: {
      ...input.command,
      id: randomUUID(),
    },
  };
};

const readSingleCommandId = (
  command: Parameters<PlugSocketExecutor>[0]["command"],
): string | undefined => {
  if (Array.isArray(command)) {
    return undefined;
  }

  const commandId = command.id;
  return typeof commandId === "string" && commandId.trim() !== "" ? commandId : undefined;
};

const logRelayFallback = (
  input: Parameters<PlugSocketExecutor>[0],
  relayInput: Parameters<PlugSocketExecutor>[0],
  fallbackReason: "probe_timeout" | "agents_command_timeout",
): void => {
  plugLogger.warn("transport.socket.manager.relay_fallback", {
    socketMode: "relay",
    agentId: input.agentId,
    fallbackReason,
    originalCommandId: readSingleCommandId(input.command),
    relayCommandId: readSingleCommandId(relayInput.command),
    doubleExecutionRisk:
      fallbackReason === "agents_command_timeout"
        ? "The original agents:command may still have completed on the server. Relay retry uses a new command ID; prefer idempotent operations or verify server state before retrying side effects."
        : undefined,
  });
};

export class ConsumerSocketExecutionManager {
  private readonly managedTransport = createManagedSocketIoTransport({
    socketMode: "agentsCommand",
    logEventKey: "manager",
    onDispose: () => {
      this.capability = "unknown";
      this.capabilityProbeInFlight = undefined;
      this.capabilityCacheKey = undefined;
      this.capabilityCheckedAtMs = 0;
      this.agentRecommendedStreamPullWindowSize = undefined;
      this.agentMaxStreamPullWindowSize = undefined;
    },
  });

  private capability: "unknown" | "supported" | "unsupported" = "unknown";

  private capabilityProbeInFlight?: Promise<boolean>;

  private capabilityCacheKey?: string;

  private capabilityCheckedAtMs = 0;

  private agentRecommendedStreamPullWindowSize?: number;

  private agentMaxStreamPullWindowSize?: number;

  private ensureTransport(baseUrl: string, accessToken: string): ConsumerSocketTransport {
    const transport = this.managedTransport.ensureTransport(baseUrl, accessToken);
    const namespaceUrl = deriveSocketNamespaceUrl(baseUrl, "/consumers");

    if (
      this.capabilityCacheKey === undefined ||
      this.capabilityCacheKey !== `${namespaceUrl}:${accessToken}`
    ) {
      this.capability = "unknown";
      this.capabilityCacheKey = `${namespaceUrl}:${accessToken}`;
      this.capabilityCheckedAtMs = 0;
      this.agentRecommendedStreamPullWindowSize = undefined;
      this.agentMaxStreamPullWindowSize = undefined;
    }

    return transport as ConsumerSocketTransport;
  }

  private async probeAgentsCommandCapability(
    input: Parameters<PlugSocketExecutor>[0],
  ): Promise<boolean> {
    const namespaceUrl = deriveSocketNamespaceUrl(
      input.session.credentials.baseUrl,
      "/consumers",
    );
    const capabilityKey = `${namespaceUrl}:${input.session.accessToken}`;
    const cacheFresh =
      this.capabilityCacheKey === capabilityKey &&
      Date.now() - this.capabilityCheckedAtMs < capabilityTtlMs;

    if (this.capability === "supported" && cacheFresh) {
      return true;
    }

    if (
      this.capability === "unsupported" &&
      cacheFresh &&
      !Array.isArray(input.command)
    ) {
      return false;
    }

    if (!this.capabilityProbeInFlight) {
      const transport = this.ensureTransport(
        input.session.credentials.baseUrl,
        input.session.accessToken,
      );
      const probeStartedAt = Date.now();
      const probeTimeoutMs = Math.max(
        250,
        Math.min(
          input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
          defaultCapabilityProbeTimeoutMs,
        ),
      );

      this.capabilityProbeInFlight = (async () => {
        try {
          const probeResult = await executeConsumerCommand({
            transport,
            session: input.session,
            agentId: input.agentId,
            command: buildConsumerSocketCapabilityProbeCommand(),
            timeoutMs: probeTimeoutMs,
            payloadFrameCompression: "default",
            payloadFrameSigning: input.payloadFrameSigning,
            responseMode: "aggregatedJson",
            bufferLimits: {
              maxBufferedBytes: 64 * 1024,
              maxBufferedChunkItems: 4,
              maxBufferedRows: 128,
            },
            requestServerTimings: input.requestServerTimings,
          });

          this.agentRecommendedStreamPullWindowSize =
            extractRecommendedStreamPullWindowSize(
              probeResult.channel === "socket" && !probeResult.notification
                ? probeResult.rawResponsePayload
                : undefined,
            );
          this.agentMaxStreamPullWindowSize = extractMaxStreamPullWindowSize(
            probeResult.channel === "socket" && !probeResult.notification
              ? probeResult.rawResponsePayload
              : undefined,
          );

          this.capability = "supported";
          plugLogger.info("transport.socket.capability_probe.supported", {
            socketMode: "agentsCommand",
            agentId: input.agentId,
            durationMs: Date.now() - probeStartedAt,
          });
          this.capabilityCacheKey = capabilityKey;
          this.capabilityCheckedAtMs = Date.now();
          return true;
        } catch (error: unknown) {
          if (error instanceof PlugTimeoutError) {
            if (Array.isArray(input.command)) {
              this.managedTransport.markStale();
              this.managedTransport.dispose();
              plugLogger.warn("transport.socket.capability_probe.batch_timeout", {
                socketMode: "agentsCommand",
                agentId: input.agentId,
                durationMs: Date.now() - probeStartedAt,
              });
              throw new PlugValidationError(
                "Execute Batch over Socket requires a Plug server that returns correlated agents:command responses. Use REST or upgrade the server.",
              );
            }

            await sleep(nextProbeBackoffMs());
            this.capability = "unsupported";
            this.capabilityCacheKey = capabilityKey;
            this.capabilityCheckedAtMs = Date.now();
            this.managedTransport.markStale();
            this.managedTransport.dispose();
            plugLogger.warn("transport.socket.capability_probe.fallback", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              durationMs: Date.now() - probeStartedAt,
              fallbackReason: "probe_timeout",
            });
            return false;
          }

          if (
            error instanceof PlugError &&
            error.code !== "SOCKET_CONNECT_ERROR" &&
            error.code !== "SOCKET_DISCONNECTED"
          ) {
            this.capability = "supported";
            this.capabilityCacheKey = capabilityKey;
            this.capabilityCheckedAtMs = Date.now();
          }

          throw error;
        } finally {
          this.capabilityProbeInFlight = undefined;
        }
      })();
    }

    return this.capabilityProbeInFlight;
  }

  async execute(
    input: Parameters<PlugSocketExecutor>[0],
    options?: {
      readonly fallbackExecutor?: PlugSocketExecutor;
      readonly preferredSocketMode?: PlugSocketImplementation;
    },
  ): Promise<Awaited<ReturnType<PlugSocketExecutor>>> {
    const preferredSocketMode = options?.preferredSocketMode ?? "agentsCommand";
    if (preferredSocketMode === "relay") {
      if (!options?.fallbackExecutor) {
        throw new PlugValidationError("Socket relay executor is not available.");
      }

      return options.fallbackExecutor(input);
    }

    const capabilitySupported = await this.probeAgentsCommandCapability(input);
    if (!capabilitySupported) {
      if (Array.isArray(input.command)) {
        throw new PlugValidationError(
          "This Plug server does not support the socket batch transport required for Execute Batch. Use REST or upgrade the server.",
        );
      }

      if (!options?.fallbackExecutor) {
        throw new PlugValidationError(
          "This Plug server does not support the preferred consumer socket transport.",
        );
      }

      plugLogger.warn("transport.socket.capability_probe.using_relay", {
        socketMode: "relay",
        agentId: input.agentId,
      });
      const relayInput = buildRelayFallbackInput(input);
      logRelayFallback(input, relayInput, "probe_timeout");
      this.managedTransport.dispose();
      return options.fallbackExecutor(relayInput);
    }

    const transport = this.ensureTransport(
      input.session.credentials.baseUrl,
      input.session.accessToken,
    );
    const executionStartedAt = Date.now();

    try {
      const result = await executeConsumerCommand({
        transport,
        session: input.session,
        agentId: input.agentId,
        command: input.command,
        timeoutMs: input.timeoutMs,
        payloadFrameCompression: input.payloadFrameCompression,
        payloadFrameSigning: input.payloadFrameSigning,
        responseMode: input.responseMode,
        bufferLimits: input.bufferLimits,
        streamPullWindowSize: input.streamPullWindowSize,
        requestServerTimings: input.requestServerTimings,
        agentRecommendedStreamPullWindowSize: this.agentRecommendedStreamPullWindowSize,
        agentMaxStreamPullWindowSize: this.agentMaxStreamPullWindowSize,
      });
      plugLogger.info("transport.socket.manager.completed", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: result.requestId,
        durationMs: Date.now() - executionStartedAt,
      });
      return result;
    } catch (error: unknown) {
      this.managedTransport.markStale();
      plugLogger.warn("transport.socket.manager.failed", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        durationMs: Date.now() - executionStartedAt,
        code: error instanceof PlugError ? error.code : undefined,
      });

      if (
        error instanceof PlugTimeoutError &&
        !Array.isArray(input.command) &&
        options?.fallbackExecutor
      ) {
        const relayInput = buildRelayFallbackInput(input);
        logRelayFallback(input, relayInput, "agents_command_timeout");
        this.managedTransport.dispose();
        return options.fallbackExecutor(relayInput);
      }

      if (error instanceof PlugTimeoutError && Array.isArray(input.command)) {
        throw new PlugValidationError(
          "Execute Batch over Socket requires a Plug server that returns correlated agents:command responses. Use REST or upgrade the server.",
        );
      }

      throw error;
    }
  }

  close(): void {
    this.managedTransport.close();
  }
}

export const createSocketCommandExecutor = (
  fallbackExecutor?: PlugSocketExecutor,
): {
  readonly execute: PlugSocketExecutor;
  readonly close: () => void;
} => {
  const manager = new ConsumerSocketExecutionManager();

  return {
    execute: (input) =>
      manager.execute(input, {
        fallbackExecutor,
      }),
    close: () => manager.close(),
  };
};
