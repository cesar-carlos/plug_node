import { io, type Socket } from "socket.io-client";

import type { PlugToolsSocketEventPublisher } from "../../generated/shared/n8n/plugToolsExecution";
import {
  publishCustomSocketEventOverSocket,
  type CustomSocketEventTransport,
} from "../../generated/shared/socket/customSocketEventSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

class SocketIoCustomEventTransport implements CustomSocketEventTransport {
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

export const publishCustomSocketEventWithSocketIo: PlugToolsSocketEventPublisher = async (
  input,
) => {
  const socket = io(
    deriveSocketNamespaceUrl(input.session.credentials.baseUrl, "/consumers"),
    {
      autoConnect: false,
      reconnection: false,
      transports: ["websocket"],
      auth: {
        token: input.session.accessToken,
      },
    },
  );

  return publishCustomSocketEventOverSocket({
    transport: new SocketIoCustomEventTransport(socket),
    request: {
      eventName: input.eventName,
      payload: input.payload,
      payloadFrameCompression: input.payloadFrameCompression,
      idempotencyKey: input.idempotencyKey,
      attachments: input.attachments,
      timeoutMs: input.timeoutMs,
    },
    payloadFrameSigning: input.payloadFrameSigning,
  });
};
