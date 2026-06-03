import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import { PlugValidationError } from "../../generated/shared/contracts/errors";
import { plugLogger } from "../../generated/shared/logging/plugLogger";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../generated/shared/socket/relaySession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";
import { createSocketIoTransport, type SocketIoTransportLike } from "./socketIoTransport";

const appErrorEvent = "app:error";
const connectErrorEvent = "connect_error";
const disconnectEvent = "disconnect";

export class RelaySocketExecutionManager {
  private transport?: SocketIoTransportLike;

  private namespaceUrl?: string;

  private accessToken?: string;

  private stale = false;

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
  }

  private ensureTransport(baseUrl: string, accessToken: string): RelaySocketTransport {
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
      plugLogger.debug("transport.socket.relay_manager.created", {
        socketMode: "relay",
        namespaceUrl,
      });
    } else {
      plugLogger.debug("transport.socket.relay_manager.reused", {
        socketMode: "relay",
        namespaceUrl,
      });
    }

    return this.transport as RelaySocketTransport;
  }

  async execute(
    input: Parameters<PlugSocketExecutor>[0],
  ): Promise<Awaited<ReturnType<PlugSocketExecutor>>> {
    if (Array.isArray(input.command)) {
      throw new PlugValidationError("Socket relay requires a single JSON-RPC command.");
    }

    const transport = this.ensureTransport(
      input.session.credentials.baseUrl,
      input.session.accessToken,
    );

    try {
      return await executeRelayCommand({
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
        managedTransport: true,
      });
    } catch (error: unknown) {
      this.stale = true;
      throw error;
    }
  }

  close(): void {
    this.disposeSocket();
    this.stale = false;
  }
}

export const createRelaySocketCommandExecutor = (): {
  readonly execute: PlugSocketExecutor;
  readonly close: () => void;
} => {
  const manager = new RelaySocketExecutionManager();

  return {
    execute: (input) => manager.execute(input),
    close: () => manager.close(),
  };
};
