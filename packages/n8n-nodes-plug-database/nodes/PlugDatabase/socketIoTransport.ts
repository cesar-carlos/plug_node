import { io, type Socket } from "socket.io-client";

import type { CustomSocketEventTransport } from "../../generated/shared/socket/customSocketEventSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

export interface SocketIoTransportLike {
  readonly id?: string;
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

class SocketIoTransport implements SocketIoTransportLike, CustomSocketEventTransport {
  constructor(private readonly socket: Socket) {}

  get id(): string | undefined {
    return this.socket.id;
  }

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

export const createSocketIoTransport = (input: {
  readonly baseUrl: string;
  readonly accessToken: string;
  readonly namespace?: string;
}): SocketIoTransportLike => {
  const namespaceUrl = deriveSocketNamespaceUrl(
    input.baseUrl,
    input.namespace ?? "/consumers",
  );

  return new SocketIoTransport(
    io(namespaceUrl, {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      auth: {
        token: input.accessToken,
      },
    }),
  );
};

export const createSocketIoTransportFromSocket = (
  socket: Socket,
): SocketIoTransportLike => new SocketIoTransport(socket);

export const createTriggerSocketTransport = (input: {
  readonly baseUrl: string;
  readonly accessToken: string;
}): CustomSocketEventTransport =>
  createSocketIoTransport({
    baseUrl: input.baseUrl,
    accessToken: input.accessToken,
  }) as CustomSocketEventTransport;

export { SocketIoTransport as SocketIoCustomEventTransport };
