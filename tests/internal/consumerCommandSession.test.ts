import { describe, expect, it } from "vitest";

import type {
  PlugSession,
  RelayConnectionReadyPayload,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/api";
import { buildNodeOutputItems } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/output/nodeOutput";
import {
  buildConsumerSocketCapabilityProbeCommand,
  executeConsumerCommand,
  type ConsumerSocketTransport,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/consumerCommandSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

class SimpleConsumerTransport implements ConsumerSocketTransport {
  connected = false;

  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    this.connected = false;
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
    this.emittedEvents.push({ event, payload });

    if (event === "agents:command") {
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: "request-1",
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

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class NotificationConsumerTransport implements ConsumerSocketTransport {
  connected = false;

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    this.connected = false;
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

  emit(event: string): void {
    if (event === "agents:command") {
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: "request-1",
          response: {
            type: "notification",
            accepted: true,
            acceptedCommands: 1,
          },
        });
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class StreamingConsumerTransport implements ConsumerSocketTransport {
  connected = false;

  streamPullRequests = 0;

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    this.connected = false;
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
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: "request-1",
          streamId: "stream-1",
          response: {
            type: "single",
            success: true,
            item: {
              id: "rpc-1",
              success: true,
              result: {
                rows: [{ id: 1, name: "Alpha" }],
                stream_id: "stream-1",
              },
            },
          },
        });
      });
      return;
    }

    if (event === "agents:stream_pull") {
      this.streamPullRequests += 1;
      const pullNumber = this.streamPullRequests;

      queueMicrotask(() => {
        this.dispatch("agents:stream_pull_response", {
          success: true,
          requestId: "request-1",
          streamId: "stream-1",
          windowSize: 1,
        });

        if (pullNumber === 1) {
          this.dispatch("agents:command_stream_chunk", {
            request_id: "request-1",
            stream_id: "stream-1",
            rows: [{ id: 2, name: "Beta" }],
          });
          return;
        }

        this.dispatch("agents:command_stream_chunk", {
          request_id: "request-1",
          stream_id: "stream-1",
          rows: [{ id: 3, name: "Gamma" }],
        });
        this.dispatch("agents:command_stream_complete", {
          request_id: "request-1",
          stream_id: "stream-1",
          terminal_status: "completed",
        });
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class InvalidStreamPullTransport implements ConsumerSocketTransport {
  connected = false;

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    this.connected = false;
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

  emit(event: string): void {
    if (event === "agents:command") {
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: "request-1",
          streamId: "stream-1",
          response: {
            type: "single",
            success: true,
            item: {
              id: "rpc-1",
              success: true,
              result: {
                rows: [{ id: 1 }],
                stream_id: "stream-1",
              },
            },
          },
        });
      });
      return;
    }

    if (event === "agents:stream_pull") {
      queueMicrotask(() => {
        this.dispatch("agents:stream_pull_response", {
          success: true,
          requestId: "request-1",
          streamId: "stream-1",
        });
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class MidStreamAppErrorTransport implements ConsumerSocketTransport {
  connected = false;

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    this.connected = false;
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

  emit(event: string): void {
    if (event === "agents:command") {
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: "request-1",
          streamId: "stream-1",
          response: {
            type: "single",
            success: true,
            item: {
              id: "rpc-1",
              success: true,
              result: {
                rows: [{ id: 1 }],
                stream_id: "stream-1",
              },
            },
          },
        });
      });
      return;
    }

    if (event === "agents:stream_pull") {
      queueMicrotask(() => {
        this.dispatch("agents:stream_pull_response", {
          success: true,
          requestId: "request-1",
          streamId: "stream-1",
          windowSize: 1,
        });
        this.dispatch("agents:command_stream_chunk", {
          request_id: "request-1",
          stream_id: "stream-1",
          rows: [{ id: 2 }],
        });
        this.dispatch("app:error", {
          code: "AGENT_ACCESS_REVOKED",
          message: "revoked",
        });
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class AppErrorConsumerTransport implements ConsumerSocketTransport {
  connected = false;

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    this.connected = false;
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

  emit(event: string): void {
    if (event === "agents:command") {
      queueMicrotask(() => {
        this.dispatch("app:error", {
          code: "AGENT_ACCESS_REVOKED",
          message: "revoked",
        });
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

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

describe("executeConsumerCommand", () => {
  it("returns normalized JSON for simple agents:command responses", async () => {
    const result = await executeConsumerCommand({
      transport: new SimpleConsumerTransport(),
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

    const items = buildNodeOutputItems(result, "aggregatedJson");

    expect(result.channel).toBe("socket");
    expect(result.socketMode).toBe("agentsCommand");
    expect(items[0]).toMatchObject({
      result: {
        policy: "approved",
      },
    });
  });

  it("supports notification responses for id:null commands", async () => {
    const result = await executeConsumerCommand({
      transport: new NotificationConsumerTransport(),
      session,
      agentId: "agent-1",
      command: buildConsumerSocketCapabilityProbeCommand(),
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });

    expect(result).toMatchObject({
      channel: "socket",
      socketMode: "agentsCommand",
      notification: true,
      acceptedCommands: 1,
    });
  });

  it("collects stream chunks with agents:stream_pull and returns final JSON rows", async () => {
    const transport = new StreamingConsumerTransport();

    const result = await executeConsumerCommand({
      transport,
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "sql.execute",
        id: "request-1",
        params: {
          sql: "SELECT 1",
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });

    const items = buildNodeOutputItems(result, "aggregatedJson");

    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({ id: 3, name: "Gamma" });
    expect(transport.streamPullRequests).toBe(2);
  });

  it("fails clearly when agents:stream_pull_response is malformed", async () => {
    await expect(
      executeConsumerCommand({
        transport: new InvalidStreamPullTransport(),
        session,
        agentId: "agent-1",
        command: {
          jsonrpc: "2.0",
          method: "sql.execute",
          id: "request-1",
          params: {
            sql: "SELECT 1",
            client_token: "client-token",
          },
        },
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
        payloadFrameCompression: "default",
      }),
    ).rejects.toThrow(
      "agents:stream_pull_response success payload must include a positive windowSize",
    );
  });

  it("fails clearly when app:error happens after the stream starts", async () => {
    await expect(
      executeConsumerCommand({
        transport: new MidStreamAppErrorTransport(),
        session,
        agentId: "agent-1",
        command: {
          jsonrpc: "2.0",
          method: "sql.execute",
          id: "request-1",
          params: {
            sql: "SELECT 1",
            client_token: "client-token",
          },
        },
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
        payloadFrameCompression: "default",
      }),
    ).rejects.toThrow("Client access to this agent was revoked.");
  });

  it("guards against oversized buffered streams", async () => {
    await expect(
      executeConsumerCommand({
        transport: new StreamingConsumerTransport(),
        session,
        agentId: "agent-1",
        command: {
          jsonrpc: "2.0",
          method: "sql.execute",
          id: "request-1",
          params: {
            sql: "SELECT 1",
            client_token: "client-token",
          },
        },
        responseMode: "chunkItems",
        timeoutMs: 5000,
        payloadFrameCompression: "default",
        bufferLimits: {
          maxBufferedBytes: 32,
          maxBufferedChunkItems: 1,
          maxBufferedRows: 1,
        },
      }),
    ).rejects.toThrow("The socket response exceeded the local buffer safety limits.");
  });

  it("fails clearly when the server emits app:error", async () => {
    await expect(
      executeConsumerCommand({
        transport: new AppErrorConsumerTransport(),
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
      }),
    ).rejects.toThrow("Client access to this agent was revoked.");
  });
});
