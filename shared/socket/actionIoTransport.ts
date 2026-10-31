import {
  ActionIoError,
  currentActionIoEncoding,
  type ActionIoTransport,
} from "../contracts/actionIo/client";
import { decodePayloadFrame, encodeJsonPayloadFrame } from "./payloadFrameCodec";
import { isRecord } from "../utils/json";
import { actionIoErrorDetails } from "../contracts/actionIo/errorDetails";

export interface ActionIoSocket {
  readonly connected: boolean;
  readonly io: {
    readonly engine?: { readonly transport?: { readonly writable?: boolean } };
  };
  readonly volatile: { emit(event: string, payload: unknown): unknown };
  on(event: string, listener: (payload: unknown) => void): unknown;
  off(event: string, listener: (payload: unknown) => void): unknown;
  emit(event: string, payload: unknown): unknown;
}
export type ActionIoSocketTransport = ActionIoTransport & { dispose(): void };
interface Pending {
  waitingRead: boolean;
  readsOutput: boolean;
  send?: () => void;
  resolve(value: unknown): void;
  reject(error: ActionIoError): void;
  timer: ReturnType<typeof setTimeout>;
}

/** Uses an already authenticated socket/conversation; never connects or retries. */
export const createSocketActionIoTransport = (options: {
  readonly socket: ActionIoSocket;
  readonly signing?: import("../contracts/payload-frame").PayloadFrameSigningOptions;
  readonly agentId: string;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly relayConversationId?: string;
}): ActionIoSocketTransport => {
  const pending = new Map<string, Pending>();
  const relay = options.relayConversationId !== undefined;
  const event = relay ? "relay:rpc.response" : "agents:command_response";
  let disposed = false;
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  // Wait before the first emission only. Never re-emit a dispatched mutation.
  const flush = (): void => {
    flushTimer = undefined;
    if (disposed || !options.socket.connected) return;
    for (const item of pending.values()) {
      if (!item.send) continue;
      if (options.socket.io.engine?.transport?.writable !== true) {
        flushTimer = setTimeout(flush, 5);
        return;
      }
      const send = item.send;
      delete item.send;
      send();
    }
  };
  const failAll = (code: string): void => {
    clearTimeout(flushTimer);
    flushTimer = undefined;
    for (const item of pending.values()) {
      clearTimeout(item.timer);
      item.reject(new ActionIoError(code, item.send === undefined && !item.readsOutput));
    }
    pending.clear();
  };
  const disconnected = (): void => failAll("SOCKET_DISCONNECTED");
  const received = (wire: unknown): void => {
    if (pending.size === 0) return;
    try {
      if (
        !isRecord(wire) ||
        typeof wire.originalSize !== "number" ||
        typeof wire.compressedSize !== "number" ||
        wire.originalSize > (options.maxResponseBytes ?? 1024 * 1024) ||
        wire.compressedSize > (options.maxResponseBytes ?? 1024 * 1024)
      ) {
        failAll("INVALID_SOCKET_FRAME");
        return;
      }
      const bytes = wire.payload;
      const wireSize =
        bytes instanceof Uint8Array
          ? bytes.byteLength
          : Array.isArray(bytes)
            ? bytes.length
            : typeof bytes === "string"
              ? bytes.length
              : Number.POSITIVE_INFINITY;
      const wireLimit =
        typeof bytes === "string"
          ? 4 * Math.ceil((options.maxResponseBytes ?? 1024 * 1024) / 3)
          : (options.maxResponseBytes ?? 1024 * 1024);
      if (wireSize > wireLimit) {
        failAll("INVALID_SOCKET_FRAME");
        return;
      }
      const decoded = decodePayloadFrame(wire, { signing: options.signing });
      if (!isRecord(decoded.data)) {
        failAll("INVALID_SOCKET_FRAME");
        return;
      }
      const body = decoded.data;
      let response: Record<string, unknown>;
      if (relay) {
        response = body;
      } else {
        if (body.agentId !== undefined && body.agentId !== options.agentId) return;
        if (
          !isRecord(body.response) ||
          body.response.type !== "single" ||
          !isRecord(body.response.item)
        ) {
          const id = body.requestId;
          if (typeof id === "string") {
            const item = pending.get(id);
            if (item && item.send === undefined) {
              pending.delete(id);
              clearTimeout(item.timer);
              const error = isRecord(body.error) ? body.error : undefined;
              const details = actionIoErrorDetails(error?.details ?? error?.data);
              item.reject(
                new ActionIoError(
                  typeof error?.code === "string"
                    ? error.code
                    : "INVALID_SOCKET_ENVELOPE",
                  details.effects_possible !== false || details.outcome_unknown === true,
                  details,
                ),
              );
            }
          }
          return;
        }
        const item = body.response.item;
        response = {
          jsonrpc: "2.0",
          id: item.id,
          ...(Object.prototype.hasOwnProperty.call(item, "meta")
            ? { meta: item.meta }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(item, "api_version")
            ? { api_version: item.api_version }
            : {}),
        };
        if (
          item.success === true &&
          Object.prototype.hasOwnProperty.call(item, "result") &&
          !Object.prototype.hasOwnProperty.call(item, "error")
        ) {
          response.result = item.result;
        } else if (
          item.success === false &&
          isRecord(item.error) &&
          !Object.prototype.hasOwnProperty.call(item, "result")
        ) {
          response.error = item.error;
        }
      }
      if (typeof response.id !== "string") return;
      const item = pending.get(response.id);
      if (!item || item.send !== undefined) return;
      pending.delete(response.id);
      clearTimeout(item.timer);
      item.resolve(response);
    } catch {
      failAll("INVALID_SOCKET_FRAME");
    }
  };
  const accepted = (body: unknown): void => {
    if (
      !isRecord(body) ||
      body.success !== false ||
      body.conversationId !== options.relayConversationId ||
      typeof body.clientRequestId !== "string" ||
      !isRecord(body.error)
    )
      return;
    const item = pending.get(body.clientRequestId);
    if (!item || item.send !== undefined) return;
    pending.delete(body.clientRequestId);
    clearTimeout(item.timer);
    const details = actionIoErrorDetails(body.error.details);
    item.reject(
      new ActionIoError(
        typeof body.error.code === "string" ? body.error.code : "RELAY_REQUEST_REFUSED",
        details.effects_possible !== false || details.outcome_unknown === true,
        details,
      ),
    );
  };
  if (relay) options.socket.on("relay:rpc.accepted", accepted);
  options.socket.on(event, received);
  options.socket.on("disconnect", disconnected);
  const transport: ActionIoTransport = async (command) => {
    if (disposed || !options.socket.connected)
      throw new ActionIoError("SOCKET_NOT_CONNECTED", false);
    if (pending.size >= 32 || pending.has(command.id))
      throw new ActionIoError("SOCKET_CAPACITY", false);
    const prepared = currentActionIoEncoding(command, transport);
    const json = prepared?.json ?? JSON.stringify(command);
    if (
      (prepared?.bytes ?? Buffer.byteLength(json, "utf8")) >
      (options.maxRequestBytes ?? 512 * 1024)
    )
      throw new ActionIoError("SOCKET_REQUEST_TOO_LARGE", false);
    const readsOutput = command.method === "agent.action.readIo";
    const waitingRead =
      readsOutput &&
      typeof command.params.wait_ms === "number" &&
      command.params.wait_ms > 0;
    if (
      waitingRead &&
      [...pending.values()].filter((item) => item.waitingRead).length >= 16
    ) {
      throw new ActionIoError("SOCKET_READER_CAPACITY", false);
    }
    // Frame before reserving a waiter; preparation failure cannot have effects.
    const payload = relay
      ? {
          conversationId: options.relayConversationId,
          timeoutMs: 30000,
          frame: encodeJsonPayloadFrame(json, {
            compression: "none",
            signing: options.signing,
          }),
        }
      : { agentId: options.agentId, timeoutMs: 30000, command };
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const dispatched = pending.get(command.id)?.send === undefined;
        pending.delete(command.id);
        reject(new ActionIoError("SOCKET_TIMEOUT", dispatched && !readsOutput));
      }, 30000);
      pending.set(command.id, { resolve, reject, timer, waitingRead, readsOutput });
      const item = pending.get(command.id)!;
      const deadline = performance.now() + 30000;
      item.send = () => {
        try {
          const remaining = Math.ceil(deadline - performance.now());
          if (remaining <= 0) {
            clearTimeout(timer);
            pending.delete(command.id);
            item.reject(new ActionIoError("SOCKET_TIMEOUT", false));
            return;
          }
          payload.timeoutMs = remaining;
          options.socket.volatile.emit(
            relay ? "relay:rpc.request" : "agents:command",
            payload,
          );
        } catch {
          pending.delete(command.id);
          clearTimeout(timer);
          item.reject(new ActionIoError("SOCKET_SEND_UNKNOWN", !readsOutput));
        }
      };
      if (flushTimer === undefined) flush();
    });
  };
  return Object.assign(transport, {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      options.socket.off(event, received);
      if (relay) options.socket.off("relay:rpc.accepted", accepted);
      options.socket.off("disconnect", disconnected);
      failAll("SOCKET_TRANSPORT_DISPOSED");
    },
  });
};
