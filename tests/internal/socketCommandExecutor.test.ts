import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  PlugSession,
  RelayConnectionReadyPayload,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/api";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

const createdSockets: MockSocket[] = [];
let suppressProbeResponse = false;

class MockSocket {
  connected = false;

  readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(
    readonly url: string,
    readonly options: Record<string, unknown>,
  ) {}

  connect(): void {
    this.connected = true;
    queueMicrotask(() => {
      this.dispatch(
        "connection:ready",
        encodePayloadFrame(
          {
            id: "socket-1",
            message: "Consumer socket connected successfully",
            user: {
              sub: "client-1",
              role: "client",
            },
          } as RelayConnectionReadyPayload,
          { requestId: "handshake", compression: "none" },
        ),
      );
    });
  }

  disconnect(): void {
    const wasConnected = this.connected;
    this.connected = false;

    if (wasConnected) {
      this.dispatch("disconnect", "io client disconnect");
    }
  }

  on(event: string, handler: (payload: unknown) => void): void {
    const eventHandlers =
      this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    eventHandlers.add(handler);
    this.handlers.set(event, eventHandlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    if (event === "agents:command") {
      const isProbe =
        typeof payload === "object" &&
        payload !== null &&
        "command" in payload &&
        typeof (payload as { command?: { method?: string; id?: unknown } }).command ===
          "object" &&
        (payload as { command?: { method?: string; id?: unknown } }).command?.method ===
          "rpc.discover" &&
        (payload as { command?: { method?: string; id?: unknown } }).command?.id === null;

      if (isProbe && suppressProbeResponse) {
        return;
      }

      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: `request-${createdSockets.indexOf(this) + 1}`,
          response: {
            type: "single",
            success: true,
            item: {
              id: "rpc-1",
              success: true,
              result: {
                policy: "approved",
              },
            },
          },
        });
      });
    }
  }

  dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

vi.mock("socket.io-client", () => ({
  io: (url: string, options: Record<string, unknown>) => {
    const socket = new MockSocket(url, options);
    createdSockets.push(socket);
    return socket;
  },
}));

const session: PlugSession = {
  credentials: {
    user: "client@example.com",
    password: "secret",
    agentId: "agent-1",
    clientToken: "client-token",
    baseUrl: "https://plug-server.example.com/api/v1",
  },
  accessToken: "access-1",
  refreshToken: "refresh-1",
  loginResponse: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    client: {
      id: "client-1",
      userId: "user-1",
      email: "client@example.com",
      name: "Plug",
      lastName: "Client",
      status: "active",
      role: "client",
    },
  },
};

describe("ConsumerSocketExecutionManager", () => {
  beforeEach(() => {
    createdSockets.length = 0;
    suppressProbeResponse = false;
  });

  it("reuses one /consumers socket across multiple commands in the same execution", async () => {
    const { ConsumerSocketExecutionManager } =
      await import("../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/socketCommandExecutor");
    const manager = new ConsumerSocketExecutionManager();

    await manager.execute({
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "request-1",
        params: {
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });
    await manager.execute({
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "request-2",
        params: {
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });

    expect(createdSockets).toHaveLength(1);
    manager.close();
  });

  it("opens a fresh socket after a disconnect between items", async () => {
    const { ConsumerSocketExecutionManager } =
      await import("../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/socketCommandExecutor");
    const manager = new ConsumerSocketExecutionManager();

    await manager.execute({
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "request-1",
        params: {
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });

    createdSockets[0].dispatch("disconnect", "transport closed");

    await manager.execute({
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "request-2",
        params: {
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });

    expect(createdSockets).toHaveLength(2);
    manager.close();
  });

  it("falls back to relay when the capability probe does not get a response", async () => {
    suppressProbeResponse = true;
    const { createSocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/socketCommandExecutor");
    const fallbackExecutor = vi.fn(async (input) => ({
      channel: "socket" as const,
      socketMode: "relay" as const,
      agentId: input.agentId,
      requestId: "relay-request-1",
      notification: false as const,
      conversationId: "conversation-1",
      accepted: {
        success: true as const,
        conversationId: "conversation-1",
        requestId: "relay-request-1",
      },
      connectionReady: {
        id: "socket-legacy-1",
        message: "ready",
        user: { id: "client-1" },
      },
      response: {
        type: "single" as const,
        success: true,
        item: {
          id: "rpc-1",
          success: true,
          result: {
            policy: "approved",
          },
        },
      },
      rawResponsePayload: {
        policy: "approved",
      },
      chunkPayloads: [],
      rawResponseFrame: {
        payload: {
          event: "relay:rpc.response",
        },
      },
      rawChunkFrames: [],
    }));
    const executor = createSocketCommandExecutor(fallbackExecutor);

    const result = await executor.execute({
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "request-1",
        params: {
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 500,
      payloadFrameCompression: "default",
    });

    expect(result.socketMode).toBe("relay");
    expect(fallbackExecutor).toHaveBeenCalledTimes(1);
    executor.close();
  });
});
