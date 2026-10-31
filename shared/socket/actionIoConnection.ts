import { randomUUID } from "node:crypto";
import { ActionIoError } from "../contracts/actionIo/client";
import { isRecord } from "../utils/json";
import { decodePayloadFrame } from "./payloadFrameCodec";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import {
  createSocketActionIoTransport,
  type ActionIoSocket,
  type ActionIoSocketTransport,
} from "./actionIoTransport";

export interface ActionIoConnection extends ActionIoSocket {
  connect(): void;
  disconnect(): void;
}
export const openActionIoConnection = async (
  socket: ActionIoConnection,
  agentId: string,
  relay: boolean,
  signing?: PayloadFrameSigningOptions,
  limits?: { maxRequestBytes?: number; maxResponseBytes?: number },
): Promise<ActionIoSocketTransport> => {
  const wait = (event: string, send: () => void): Promise<unknown> =>
    new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.off(event, received);
        socket.off("connect_error", failed);
        socket.off("disconnect", failed);
        socket.off("app:error", failed);
      };
      const received = (body: unknown): void => {
        cleanup();
        resolve(body);
      };
      const failed = (): void => {
        cleanup();
        reject(new ActionIoError("SOCKET_SETUP_FAILED", false));
      };
      const timer = setTimeout(failed, 10000);
      socket.on(event, received);
      socket.on("connect_error", failed);
      socket.on("disconnect", failed);
      socket.on("app:error", failed);
      try {
        send();
      } catch {
        failed();
      }
    });
  try {
    await wait("connection:ready", () => socket.connect());
    let conversationId: string | undefined;
    if (relay) {
      const requestId = randomUUID();
      const wire = await wait("relay:conversation.started", () =>
        socket.emit("relay:conversation.start", { agentId, requestId }),
      );
      const body =
        isRecord(wire) && "enc" in wire
          ? decodePayloadFrame(wire, { signing }).data
          : wire;
      if (
        isRecord(body) &&
        body.requestId === requestId &&
        body.success === false &&
        isRecord(body.error) &&
        body.error.code === "RATE_LIMITED"
      )
        throw new ActionIoError("RATE_LIMITED", false);
      if (
        !isRecord(body) ||
        body.success !== true ||
        body.agentId !== agentId ||
        typeof body.conversationId !== "string" ||
        !body.conversationId.trim() ||
        (body.requestId !== undefined && body.requestId !== requestId)
      )
        throw new ActionIoError("RELAY_SETUP_FAILED", false);
      conversationId = body.conversationId;
    }
    const transport = createSocketActionIoTransport({
      socket,
      agentId,
      relayConversationId: conversationId,
      signing,
      ...limits,
    });
    let disposed = false;
    const disposeTransport = transport.dispose;
    return Object.assign(transport, {
      dispose(): void {
        if (disposed) return;
        disposed = true;
        disposeTransport();
        try {
          if (conversationId && socket.connected)
            socket.volatile.emit("relay:conversation.end", { conversationId });
        } catch {
          // The remote end notification is best effort during teardown.
        } finally {
          socket.disconnect();
        }
      },
    });
  } catch (error) {
    socket.disconnect();
    throw error;
  }
};
