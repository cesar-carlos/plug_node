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

  private activeCount = 0;

  private disposePending = false;

  stale = false;

  constructor(private readonly options: ManagedSocketIoTransportOptions) {}

  private readonly handleTerminalEvent = (): void => {
    this.stale = true;
  };

  /**
   * Track in-flight work that depends on the live socket so dispose can be deferred.
   */
  acquire(): void {
    this.activeCount += 1;
  }

  release(): void {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.disposePending && this.activeCount === 0) {
      this.disposePending = false;
      this.disposeNow();
    }
  }

  getActiveCount(): number {
    return this.activeCount;
  }

  private disposeNow(): void {
    if (this.transport) {
      for (const event of socketTerminalEvents) {
        this.transport.off(event, this.handleTerminalEvent);
      }
      this.transport.disconnect();
    }

    this.transport = undefined;
    this.namespaceUrl = undefined;
    this.accessToken = undefined;
    this.disposePending = false;
    this.options.onDispose?.();
  }

  dispose(): void {
    if (this.activeCount > 0) {
      this.stale = true;
      this.disposePending = true;
      plugLogger.debug(`transport.socket.${this.options.logEventKey}.dispose_deferred`, {
        socketMode: this.options.socketMode,
        activeCount: this.activeCount,
      });
      return;
    }

    this.disposeNow();
  }

  markStale(): void {
    this.stale = true;
  }

  ensureTransport(baseUrl: string, accessToken: string): SocketIoTransportLike {
    const namespaceUrl = deriveSocketNamespaceUrl(baseUrl, "/consumers");
    const shouldRecreate =
      this.transport === undefined || this.stale || this.namespaceUrl !== namespaceUrl;

    if (shouldRecreate) {
      if (this.transport !== undefined && this.activeCount > 0) {
        // Keep the live socket for in-flight work; recreate once the refcount hits 0.
        this.disposePending = true;
        this.stale = true;
        const tokenRotated = this.accessToken !== accessToken;
        this.accessToken = accessToken;
        if (tokenRotated) {
          this.transport.updateAccessToken?.(accessToken);
        }
        plugLogger.debug(`transport.socket.${this.options.logEventKey}.reuse_while_active`, {
          socketMode: this.options.socketMode,
          namespaceUrl,
          activeCount: this.activeCount,
          tokenRotated,
        });
        return this.transport;
      }

      this.disposeNow();

      const transport = createSocketIoTransport({ baseUrl, accessToken });
      for (const event of socketTerminalEvents) {
        transport.on(event, this.handleTerminalEvent);
      }

      this.transport = transport;
      this.namespaceUrl = namespaceUrl;
      this.accessToken = accessToken;
      this.stale = false;
      this.disposePending = false;
      plugLogger.debug(`transport.socket.${this.options.logEventKey}.created`, {
        socketMode: this.options.socketMode,
        namespaceUrl,
      });
    } else {
      // Token rotation requires a new handshake (reconnection is disabled).
      const tokenRotated = this.accessToken !== accessToken;
      this.accessToken = accessToken;
      if (tokenRotated) {
        if (this.activeCount > 0) {
          this.stale = true;
          this.disposePending = true;
          this.transport?.updateAccessToken?.(accessToken);
          plugLogger.debug(`transport.socket.${this.options.logEventKey}.token_rotated_deferred`, {
            socketMode: this.options.socketMode,
            namespaceUrl,
            activeCount: this.activeCount,
          });
          return this.transport as SocketIoTransportLike;
        }

        this.disposeNow();
        const transport = createSocketIoTransport({ baseUrl, accessToken });
        for (const event of socketTerminalEvents) {
          transport.on(event, this.handleTerminalEvent);
        }
        this.transport = transport;
        this.namespaceUrl = namespaceUrl;
        this.accessToken = accessToken;
        this.stale = false;
        this.disposePending = false;
        plugLogger.debug(`transport.socket.${this.options.logEventKey}.recreated_after_token_rotation`, {
          socketMode: this.options.socketMode,
          namespaceUrl,
        });
        return transport;
      }

      plugLogger.debug(`transport.socket.${this.options.logEventKey}.reused`, {
        socketMode: this.options.socketMode,
        namespaceUrl,
        tokenRotated: false,
      });
    }

    return this.transport as SocketIoTransportLike;
  }

  close(): void {
    this.disposePending = false;
    this.activeCount = 0;
    this.disposeNow();
    this.stale = false;
  }
}

export const createManagedSocketIoTransport = (
  options: ManagedSocketIoTransportOptions,
): ManagedSocketIoTransport => new ManagedSocketIoTransport(options);
