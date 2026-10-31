import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { openActionIoConnection } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/actionIoConnection";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";

class Socket extends EventEmitter {
  reply: Record<string, unknown> = { agentId: "a", conversationId: "c" };
  connected = false;
  io = { engine: { transport: { writable: true } } };
  volatile = { emit: vi.fn() };
  connect(): void {
    this.connected = true;
    queueMicrotask(() => super.emit("connection:ready", {}));
  }
  disconnect(): void {
    this.connected = false;
    super.emit("disconnect");
  }
  override emit(event: string, body?: unknown): boolean {
    if (event === "relay:conversation.start") {
      const request = body as { requestId: string };
      queueMicrotask(() =>
        super.emit(
          "relay:conversation.started",
          encodePayloadFrame({
            requestId: request.requestId,
            success: true,
            ...this.reply,
          }),
        ),
      );
      return true;
    }
    return super.emit(event, body);
  }
}
describe("scoped action connection", () => {
  it.each([true, false])(
    "opens and closes one authenticated connection relay=%s",
    async (relay) => {
      const socket = new Socket();
      const transport = await openActionIoConnection(socket, "a", relay);
      expect(socket.connected).toBe(true);
      transport.dispose();
      expect(socket.connected).toBe(false);
      expect(socket.listenerCount("connection:ready")).toBe(0);
      expect(socket.listenerCount("disconnect")).toBe(0);
      if (relay)
        expect(socket.volatile.emit).toHaveBeenCalledWith("relay:conversation.end", {
          conversationId: "c",
        });
    },
  );
  it.each([
    { agentId: "other", conversationId: "c" },
    { agentId: "a", conversationId: " " },
  ])("rejects mismatched relay setup %o", async (reply) => {
    const socket = new Socket();
    socket.reply = reply;
    await expect(openActionIoConnection(socket, "a", true)).rejects.toMatchObject({
      code: "RELAY_SETUP_FAILED",
    });
    expect(socket.connected).toBe(false);
    expect(socket.volatile.emit).not.toHaveBeenCalled();
  });
  it("disconnects even when ending the conversation fails", async () => {
    const socket = new Socket();
    const transport = await openActionIoConnection(socket, "a", true);
    socket.volatile.emit.mockImplementation(() => {
      throw new Error("closed");
    });
    transport.dispose();
    transport.dispose();
    expect(socket.connected).toBe(false);
    expect(socket.volatile.emit).toHaveBeenCalledTimes(1);
  });
  it("reports a correlated relay quota refusal before dispatch", async () => {
    const socket = new Socket();
    socket.reply = { success: false, error: { code: "RATE_LIMITED" } };
    await expect(openActionIoConnection(socket, "a", true)).rejects.toMatchObject({
      code: "RATE_LIMITED",
      details: { outcome_unknown: false },
    });
    expect(socket.connected).toBe(false);
  });
  it("does not expose native connection failures or leave setup listeners", async () => {
    const socket = new Socket();
    socket.connect = () => {
      throw new Error("secret");
    };
    await expect(openActionIoConnection(socket, "a", false)).rejects.toMatchObject({
      code: "SOCKET_SETUP_FAILED",
      details: { outcome_unknown: false },
    });
    expect(socket.listenerCount("app:error")).toBe(0);
  });
});
