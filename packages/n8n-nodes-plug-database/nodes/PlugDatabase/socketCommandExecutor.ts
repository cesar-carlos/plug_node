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
import { createSocketIoTransport, type SocketIoTransportLike } from "./socketIoTransport";

const appErrorEvent = "app:error";
const connectErrorEvent = "connect_error";
const disconnectEvent = "disconnect";
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

export class ConsumerSocketExecutionManager {
  private transport?: SocketIoTransportLike;

  private namespaceUrl?: string;

  private accessToken?: string;

  private stale = false;

  private capability: "unknown" | "supported" | "unsupported" = "unknown";

  private capabilityProbeInFlight?: Promise<boolean>;

  private capabilityCacheKey?: string;

  private capabilityCheckedAtMs = 0;

  private readonly handleTerminalEvent = (): void => {
    this.stale = true;
  };

  private disposeSocket(): void {
    if (this.transport) {
      this.transport.off(appErrorEvent, this.handleTerminalEvent);
      this.transport.off(connectErrorEvent, this.handleTerminalEvent);
      this.transport.off(disconnectEvent, this.handleTerminalEvent);
      this.transport.disconnect();
    }

    this.transport = undefined;
    this.namespaceUrl = undefined;
    this.accessToken = undefined;
    this.capability = "unknown";
    this.capabilityProbeInFlight = undefined;
    this.capabilityCacheKey = undefined;
    this.capabilityCheckedAtMs = 0;
  }

  private ensureTransport(baseUrl: string, accessToken: string): ConsumerSocketTransport {
    const namespaceUrl = deriveSocketNamespaceUrl(baseUrl, "/consumers");
    const shouldRecreate =
      this.transport === undefined ||
      this.stale ||
      this.namespaceUrl !== namespaceUrl ||
      this.accessToken !== accessToken;

    if (shouldRecreate) {
      this.disposeSocket();

      const transport = createSocketIoTransport({ baseUrl, accessToken });
      transport.on(appErrorEvent, this.handleTerminalEvent);
      transport.on(connectErrorEvent, this.handleTerminalEvent);
      transport.on(disconnectEvent, this.handleTerminalEvent);

      this.transport = transport;
      this.namespaceUrl = namespaceUrl;
      this.accessToken = accessToken;
      this.stale = false;
      this.capability = "unknown";
      this.capabilityCacheKey = `${namespaceUrl}:${accessToken}`;
      this.capabilityCheckedAtMs = 0;
      plugLogger.debug("transport.socket.manager.created", {
        socketMode: "agentsCommand",
        namespaceUrl,
      });
    } else {
      plugLogger.debug("transport.socket.manager.reused", {
        socketMode: "agentsCommand",
        namespaceUrl,
      });
    }

    return this.transport as ConsumerSocketTransport;
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
          await executeConsumerCommand({
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
          });

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
            await sleep(nextProbeBackoffMs());
            if (Array.isArray(input.command)) {
              this.stale = true;
              this.transport?.disconnect();
              plugLogger.warn("transport.socket.capability_probe.try_direct_batch", {
                socketMode: "agentsCommand",
                agentId: input.agentId,
                durationMs: Date.now() - probeStartedAt,
                fallbackReason: "probe_timeout",
              });
              return true;
            }

            this.capability = "unsupported";
            this.capabilityCacheKey = capabilityKey;
            this.capabilityCheckedAtMs = Date.now();
            this.stale = true;
            this.transport?.disconnect();
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
      return options.fallbackExecutor(input);
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
      });
      plugLogger.info("transport.socket.manager.completed", {
        socketMode: "agentsCommand",
        agentId: input.agentId,
        requestId: result.requestId,
        durationMs: Date.now() - executionStartedAt,
      });
      return result;
    } catch (error: unknown) {
      this.stale = true;
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
        plugLogger.warn("transport.socket.manager.timeout_using_relay", {
          socketMode: "relay",
          agentId: input.agentId,
        });
        return options.fallbackExecutor(input);
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
    this.disposeSocket();
    this.stale = false;
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
