import { io, type Socket } from "socket.io-client";

import type { CustomSocketEventTransport } from "../../generated/shared/socket/customSocketEventSession";
import type { PlugSession } from "../../generated/shared/contracts/api";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

export class SocketIoCustomEventTransport implements CustomSocketEventTransport {
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

export const createSocketIoCustomEventTransport = (
  session: PlugSession,
): SocketIoCustomEventTransport =>
  new SocketIoCustomEventTransport(
    io(deriveSocketNamespaceUrl(session.credentials.baseUrl, "/consumers"), {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      auth: {
        token: session.accessToken,
      },
    }),
  );
