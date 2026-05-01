import { io, type Socket } from "socket.io-client";

import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../generated/shared/socket/relaySession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

class SocketIoRelayTransport implements RelaySocketTransport {
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

export const executeSocketCommand: PlugSocketExecutor = async (input) => {
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

  const transport = new SocketIoRelayTransport(socket);

  try {
    return await executeRelayCommand({
      transport,
      session: input.session,
      command: input.command,
      timeoutMs: input.timeoutMs,
      responseMode: input.responseMode,
    });
  } finally {
    transport.disconnect();
  }
};
