import { io, type Socket } from "socket.io-client";

import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PlugSocketImplementation,
} from "../../generated/shared/contracts/api";
import { PlugError, PlugTimeoutError, PlugValidationError } from "../../generated/shared/contracts/errors";
import { plugLogger } from "../../generated/shared/logging/plugLogger";
import {
  buildConsumerSocketCapabilityProbeCommand,
  executeConsumerCommand,
  type ConsumerSocketTransport,
} from "../../generated/shared/socket/consumerCommandSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

const appErrorEvent = "app:error";
const connectErrorEvent = "connect_error";
const disconnectEvent = "disconnect";
const defaultCapabilityProbeTimeoutMs = 1_500;

class SocketIoConsumerTransport implements ConsumerSocketTransport {
  constructor(private readonly socket: Socket) {}

  get connected(): boolean {
    return this.socket.connected;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.socket.on(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.socket.off(event, handler);
  }

  emit(event: string, payload?: unknown): void {
    if (payload === undefined) {
      this.socket.emit(event);
      return;
    }

    this.socket.emit(event, payload);
  }
}

export class ConsumerSocketExecutionManager {
  private socket?: Socket;

  private transport?: SocketIoConsumerTransport;

  private namespaceUrl?: string;

  private accessToken?: string;

  private stale = false;

  private capability: "unknown" | "supported" | "unsupported" = "unknown";

  private capabilityProbeInFlight?: Promise<boolean>;

  private readonly handleTerminalEvent = (): void => {
    this.stale = true;
  };

  private disposeSocket(): void {
    if (this.socket) {
      this.socket.off(appErrorEvent, this.handleTerminalEvent);
      this.socket.off(connectErrorEvent, this.handleTerminalEvent);
      this.socket.off(disconnectEvent, this.handleTerminalEvent);
      this.socket.disconnect();
    }

    this.socket = undefined;
    this.transport = undefined;
    this.namespaceUrl = undefined;
    this.accessToken = undefined;
    this.capability = "unknown";
    this.capabilityProbeInFlight = undefined;
  }

  private ensureTransport(baseUrl: string, accessToken: string): ConsumerSocketTransport {
    const namespaceUrl = deriveSocketNamespaceUrl(baseUrl, "/consumers");
    const shouldRecreate =
      this.transport === undefined ||
      this.socket === undefined ||
      this.stale ||
      this.namespaceUrl !== namespaceUrl ||
      this.accessToken !== accessToken;

    if (shouldRecreate) {
      this.disposeSocket();

      const socket = io(namespaceUrl, {
        autoConnect: false,
        reconnection: false,
        transports: ["websocket"],
        auth: {
          token: accessToken,
        },
      });

      socket.on(appErrorEvent, this.handleTerminalEvent);
      socket.on(connectErrorEvent, this.handleTerminalEvent);
      socket.on(disconnectEvent, this.handleTerminalEvent);

      this.socket = socket;
      this.transport = new SocketIoConsumerTransport(socket);
      this.namespaceUrl = namespaceUrl;
      this.accessToken = accessToken;
      this.stale = false;
      this.capability = "unknown";
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
    if (this.capability === "supported") {
      return true;
    }

    if (this.capability === "unsupported") {
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
        Math.min(input.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, defaultCapabilityProbeTimeoutMs),
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
          return true;
        } catch (error: unknown) {
          if (error instanceof PlugTimeoutError) {
            this.capability = "unsupported";
            this.stale = true;
            this.socket?.disconnect();
            plugLogger.warn("transport.socket.capability_probe.fallback", {
              socketMode: "agentsCommand",
              agentId: input.agentId,
              durationMs: Date.now() - probeStartedAt,
            });
            return false;
          }

          if (
            error instanceof PlugError &&
            error.code !== "SOCKET_CONNECT_ERROR" &&
            error.code !== "SOCKET_DISCONNECTED"
          ) {
            this.capability = "supported";
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
        responseMode: input.responseMode,
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
