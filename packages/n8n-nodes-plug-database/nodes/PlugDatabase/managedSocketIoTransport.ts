import { plugLogger } from "../../generated/shared/logging/plugLogger";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";
import { createSocketIoTransport, type SocketIoTransportLike } from "./socketIoTransport";

export const socketTerminalEvents = ["app:error", "connect_error", "disconnect"] as const;

export interface ManagedSocketIoTransportOptions {
  readonly socketMode: string;
  readonly logEventKey: string;
  readonly onDispose?: () => void;
}

export class ManagedSocketIoTransport {
  private transport?: SocketIoTransportLike;

  private namespaceUrl?: string;

  private accessToken?: string;

  stale = false;

  constructor(private readonly options: ManagedSocketIoTransportOptions) {}

  private readonly handleTerminalEvent = (): void => {
    this.stale = true;
  };

  dispose(): void {
    if (this.transport) {
      for (const event of socketTerminalEvents) {
        this.transport.off(event, this.handleTerminalEvent);
      }
      this.transport.disconnect();
    }

    this.transport = undefined;
    this.namespaceUrl = undefined;
    this.accessToken = undefined;
    this.options.onDispose?.();
  }

  markStale(): void {
    this.stale = true;
  }

  ensureTransport(baseUrl: string, accessToken: string): SocketIoTransportLike {
    const namespaceUrl = deriveSocketNamespaceUrl(baseUrl, "/consumers");
    const shouldRecreate =
      this.transport === undefined ||
      this.stale ||
      this.namespaceUrl !== namespaceUrl ||
      this.accessToken !== accessToken;

    if (shouldRecreate) {
      this.dispose();

      const transport = createSocketIoTransport({ baseUrl, accessToken });
      for (const event of socketTerminalEvents) {
        transport.on(event, this.handleTerminalEvent);
      }

      this.transport = transport;
      this.namespaceUrl = namespaceUrl;
      this.accessToken = accessToken;
      this.stale = false;
      plugLogger.debug(`transport.socket.${this.options.logEventKey}.created`, {
        socketMode: this.options.socketMode,
        namespaceUrl,
      });
    } else {
      plugLogger.debug(`transport.socket.${this.options.logEventKey}.reused`, {
        socketMode: this.options.socketMode,
        namespaceUrl,
      });
    }

    return this.transport as SocketIoTransportLike;
  }

  close(): void {
    this.dispose();
    this.stale = false;
  }
}

export const createManagedSocketIoTransport = (
  options: ManagedSocketIoTransportOptions,
): ManagedSocketIoTransport => new ManagedSocketIoTransport(options);
