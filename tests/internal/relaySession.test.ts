import { describe, expect, it } from "vitest";

import type {
  PlugSession,
  RelayConnectionReadyPayload,
  RpcSingleCommand,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { buildNodeOutputItems } from "../../packages/n8n-nodes-plug-database/generated/shared/output/nodeOutput";
import { isRecord } from "../../packages/n8n-nodes-plug-database/generated/shared/utils/json";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/relaySession";
import {
  decodePayloadFrame,
  encodePayloadFrame,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";

class MockRelayTransport implements RelaySocketTransport {
  connected = false;
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];
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
    this.emittedEvents.push({ event, payload });

    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.accepted", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          clientRequestId: "client-request-1",
        });
        this.dispatch(
          "relay:rpc.response",
          encodePayloadFrame(
            {
              jsonrpc: "2.0",
              id: "relay-request-1",
              result: {
                rows: [{ id: 1, name: "Alpha" }],
                stream_id: "stream-1",
              },
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
      });
      return;
    }

    if (event === "relay:rpc.stream.pull") {
      this.streamPullRequests += 1;
      void payload;
      queueMicrotask(() => {
        this.dispatch("relay:rpc.stream.pull_response", {
          success: true,
          conversationId: "other-conversation",
          requestId: "other-request",
          streamId: "other-stream",
          windowSize: 99,
        });
        this.dispatch("relay:rpc.stream.pull_response", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          streamId: "stream-1",
          windowSize: 32,
          rateLimit: {
            remainingCredits: 900,
            limit: 1000,
            scope: "user",
          },
        });
        this.dispatch(
          "relay:rpc.chunk",
          encodePayloadFrame(
            {
              request_id: "relay-request-1",
              stream_id: "stream-1",
              rows: [{ id: 2, name: "Beta" }],
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
        this.dispatch(
          "relay:rpc.complete",
          encodePayloadFrame(
            {
              request_id: "relay-request-1",
              stream_id: "stream-1",
              total_rows: 2,
              terminal_status: "completed",
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class DynamicWindowRelayTransport implements RelaySocketTransport {
  connected = false;
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];
  streamPullRequests = 0;
  readonly requestedWindows: number[] = [];
  readonly streamPullTraceIds: Array<string | undefined> = [];

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

    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.accepted", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          clientRequestId: "client-request-1",
        });
        this.dispatch(
          "relay:rpc.response",
          encodePayloadFrame(
            {
              jsonrpc: "2.0",
              id: "relay-request-1",
              result: {
                rows: [{ id: 1, name: "Alpha" }],
                stream_id: "stream-1",
              },
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
      });
      return;
    }

    if (event === "relay:rpc.stream.pull") {
      this.streamPullRequests += 1;
      const pullNumber = this.streamPullRequests;
      const frame = (payload as { readonly frame?: unknown } | undefined)?.frame;
      if (frame) {
        const decoded = decodePayloadFrame<{ readonly window_size?: number }>(frame);
        this.requestedWindows.push(decoded.data.window_size ?? 0);
        this.streamPullTraceIds.push(decoded.frame.traceId);
      }

      queueMicrotask(() => {
        this.dispatch("relay:rpc.stream.pull_response", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          streamId: "stream-1",
          windowSize: 1,
        });

        if (pullNumber === 1) {
          this.dispatch(
            "relay:rpc.chunk",
            encodePayloadFrame(
              {
                request_id: "relay-request-1",
                stream_id: "stream-1",
                rows: [{ id: 2, name: "Beta" }],
              },
              { requestId: "relay-request-1", compression: "none" },
            ),
          );
          return;
        }

        this.dispatch(
          "relay:rpc.chunk",
          encodePayloadFrame(
            {
              request_id: "relay-request-1",
              stream_id: "stream-1",
              rows: [{ id: 3, name: "Gamma" }],
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
        this.dispatch(
          "relay:rpc.complete",
          encodePayloadFrame(
            {
              request_id: "relay-request-1",
              stream_id: "stream-1",
              total_rows: 3,
              terminal_status: "completed",
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class TimeoutRelayTransport implements RelaySocketTransport {
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

    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.accepted", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          clientRequestId: "client-request-1",
        });
      });
    }
  }

  countHandlers(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class DisconnectRelayTransport implements RelaySocketTransport {
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
    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("disconnect", "transport closed");
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class MalformedAcceptedRelayTransport implements RelaySocketTransport {
  connected = false;

  constructor(private readonly acceptedPayload: unknown) {}

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
    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.accepted", this.acceptedPayload);
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class MalformedPullRelayTransport implements RelaySocketTransport {
  connected = false;

  constructor(private readonly pullPayload: unknown) {}

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
    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.accepted", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          clientRequestId: "client-request-1",
        });
        this.dispatch(
          "relay:rpc.response",
          encodePayloadFrame(
            {
              jsonrpc: "2.0",
              id: "relay-request-1",
              result: {
                rows: [{ id: 1 }],
                stream_id: "stream-1",
              },
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
      });
      return;
    }

    if (event === "relay:rpc.stream.pull") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.stream.pull_response", this.pullPayload);
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class LargeChunkRelayTransport implements RelaySocketTransport {
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
    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.accepted", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          clientRequestId: "client-request-1",
        });
        this.dispatch(
          "relay:rpc.response",
          encodePayloadFrame(
            {
              jsonrpc: "2.0",
              id: "relay-request-1",
              result: {
                rows: [],
                stream_id: "stream-1",
              },
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
      });
      return;
    }

    if (event === "relay:rpc.stream.pull") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.stream.pull_response", {
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          streamId: "stream-1",
          windowSize: 1,
        });
        this.dispatch(
          "relay:rpc.chunk",
          encodePayloadFrame(
            {
              request_id: "relay-request-1",
              stream_id: "stream-1",
              rows: Array.from({ length: 130_000 }, (_, index) => ({ id: index })),
            },
            { requestId: "relay-request-1", compression: "default" },
          ),
        );
        this.dispatch(
          "relay:rpc.complete",
          encodePayloadFrame(
            {
              request_id: "relay-request-1",
              stream_id: "stream-1",
              total_rows: 130_000,
              terminal_status: "completed",
            },
            { requestId: "relay-request-1", compression: "none" },
          ),
        );
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

describe("executeRelayCommand", () => {
  it("collects relay SQL stream chunks and exposes them for node output shaping", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "sql.execute",
      id: "client-request-1",
      params: {
        sql: "SELECT 1",
        client_token: "client-token",
      },
    };

    const transportResult = await executeRelayCommand({
      transport: new MockRelayTransport(),
      session,
      command,
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
    });

    const items = buildNodeOutputItems(transportResult, "aggregatedJson");

    expect(transportResult.channel).toBe("socket");
    expect(transportResult.chunkPayloads).toHaveLength(0);
    expect(transportResult.rawChunkFrames).toHaveLength(0);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ id: 1, name: "Alpha" });
    expect(items[1]).toMatchObject({ id: 2, name: "Beta" });
  });

  it("uses the window size returned by the relay pull response", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "sql.execute",
      id: "client-request-1",
      params: {
        sql: "SELECT 1",
        client_token: "client-token",
      },
    };
    const transport = new DynamicWindowRelayTransport();

    const transportResult = await executeRelayCommand({
      transport,
      session,
      command,
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      streamPullWindowSize: 7,
    });

    const items = buildNodeOutputItems(transportResult, "aggregatedJson");

    expect(items).toHaveLength(3);
    expect(items[2]).toMatchObject({ id: 3, name: "Gamma" });
    expect(transport.streamPullRequests).toBe(2);
    expect(transport.requestedWindows).toEqual([7, 7]);
    expect(transport.streamPullTraceIds).toEqual([undefined, undefined]);
    expect(
      transport.emittedEvents.some(({ event }) => event === "relay:conversation.end"),
    ).toBe(true);
  });

  it("aggregates large relay chunks without storing chunk payloads in aggregated mode", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "sql.execute",
      id: "client-request-1",
      params: {
        sql: "SELECT 1",
        client_token: "client-token",
      },
    };

    const transportResult = await executeRelayCommand({
      transport: new LargeChunkRelayTransport(),
      session,
      command,
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      bufferLimits: {
        maxBufferedBytes: 20 * 1024 * 1024,
        maxBufferedChunkItems: 2,
        maxBufferedRows: 150_000,
      },
    });

    const items = buildNodeOutputItems(transportResult, "aggregatedJson");

    expect(transportResult.chunkPayloads).toHaveLength(0);
    expect(transportResult.rawChunkFrames).toHaveLength(0);
    expect(items).toHaveLength(130_000);
    expect(items[129_999]).toMatchObject({ id: 129_999 });
  });

  it("cleans up relay listeners and closes the conversation when a timeout happens", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "client_token.getPolicy",
      id: "client-request-1",
      params: {
        client_token: "client-token",
      },
    };
    const transport = new TimeoutRelayTransport();

    await expect(
      executeRelayCommand({
        transport,
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 25,
      }),
    ).rejects.toThrow("Timed out while waiting for relay RPC completion");

    expect(transport.connected).toBe(false);
    expect(transport.countHandlers("relay:rpc.response")).toBe(0);
    expect(transport.countHandlers("relay:rpc.chunk")).toBe(0);
    expect(transport.countHandlers("relay:rpc.complete")).toBe(0);
    expect(transport.countHandlers("app:error")).toBe(0);
    expect(
      transport.emittedEvents.some(({ event }) => event === "relay:conversation.end"),
    ).toBe(true);
  });

  it("allows sql.executeBatch as a single relay command", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "sql.executeBatch",
      id: "client-request-1",
      params: {
        client_token: "client-token",
        commands: [{ sql: "SELECT 1" }, { sql: "SELECT 2" }],
      },
    };

    const transportResult = await executeRelayCommand({
      transport: new MockRelayTransport(),
      session,
      command,
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
    });

    expect(transportResult).toMatchObject({
      channel: "socket",
      socketMode: "relay",
      requestId: "relay-request-1",
    });
  });

  it("rejects malformed relay:rpc.accepted control payloads", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "client_token.getPolicy",
      id: "client-request-1",
      params: {
        client_token: "client-token",
      },
    };

    await expect(
      executeRelayCommand({
        transport: new MalformedAcceptedRelayTransport({
          success: true,
          conversationId: "conversation-1",
        }),
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("relay:rpc.accepted success payload must include requestId");

    await expect(
      executeRelayCommand({
        transport: new MalformedAcceptedRelayTransport({
          success: false,
          error: { message: "failed" },
        }),
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(
      "relay:rpc.accepted failure payload must include error.code and error.message",
    );

    await expect(
      executeRelayCommand({
        transport: new MalformedAcceptedRelayTransport({
          requestId: "relay-request-1",
        }),
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow("relay:rpc.accepted must include success boolean");
  });

  it("fails clearly for malformed relay:rpc.stream.pull_response payloads", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "sql.execute",
      id: "client-request-1",
      params: {
        sql: "SELECT 1",
        client_token: "client-token",
      },
    };

    await expect(
      executeRelayCommand({
        transport: new MalformedPullRelayTransport({
          success: true,
          conversationId: "conversation-1",
          requestId: "relay-request-1",
          streamId: "stream-1",
        }),
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(
      "relay:rpc.stream.pull_response success payload must include a positive windowSize",
    );

    await expect(
      executeRelayCommand({
        transport: new MalformedPullRelayTransport({
          success: false,
          error: { code: "RATE_LIMITED" },
        }),
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toThrow(
      "relay:rpc.stream.pull_response failure payload must include error.code and error.message",
    );
  });

  it("returns relay runtime metrics and handles inFlight accepted payloads", async () => {
    class InFlightRelayTransport extends MockRelayTransport {
      override emit(event: string, payload?: unknown): void {
        if (event === "relay:rpc.request") {
          queueMicrotask(() => {
            this.dispatch("relay:rpc.accepted", {
              success: true,
              conversationId: "conversation-1",
              requestId: "relay-request-1",
              clientRequestId: "client-request-1",
              inFlight: true,
            });
            this.dispatch(
              "relay:rpc.response",
              encodePayloadFrame(
                {
                  jsonrpc: "2.0",
                  id: "relay-request-1",
                  result: { policy: "ok" },
                },
                { requestId: "relay-request-1", compression: "none" },
              ),
            );
          });
          return;
        }

        super.emit(event, payload);
      }
    }

    const result = await executeRelayCommand({
      transport: new InFlightRelayTransport(),
      session,
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "client-request-1",
        params: { client_token: "token" },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
    });

    expect(result.metrics?.ignoredCommandResponses).toBe(0);
    expect(result.executionMetrics?.connectedAfterMs).toBeGreaterThanOrEqual(0);
    expect(result.accepted?.inFlight).toBe(true);
  });

  it("routes unary relay responses without relay:rpc.accepted when fastPath is enabled", async () => {
    class FastPathRelayTransport extends MockRelayTransport {
      override emit(event: string, payload?: unknown): void {
        this.emittedEvents.push({ event, payload });

        if (event === "relay:conversation.start") {
          queueMicrotask(() => {
            this.dispatch("relay:conversation.started", {
              success: true,
              conversationId: "conversation-1",
              agentId: "agent-1",
            });
          });
          return;
        }

        if (event === "relay:rpc.request") {
          queueMicrotask(() => {
            this.dispatch(
              "relay:rpc.response",
              encodePayloadFrame(
                {
                  jsonrpc: "2.0",
                  id: "client-request-1",
                  result: { rows: [{ id: 1 }] },
                },
                { requestId: "hub-request-1", compression: "none" },
              ),
            );
          });
        }
      }
    }

    const transport = new FastPathRelayTransport();
    transport.connect();

    const result = await executeRelayCommand({
      transport,
      session,
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        id: "client-request-1",
        params: { client_token: "client-token" },
      },
      responseMode: "aggregatedJson",
      fastPath: true,
      managedTransport: true,
      skipConversationEnd: true,
    });

    expect(result.requestId).toBe("hub-request-1");
    expect(result.accepted).toBeUndefined();
    expect(result.metrics?.fastPath).toBe(true);
    expect(
      transport.emittedEvents.some(
        (entry) =>
          entry.event === "relay:rpc.request" &&
          isRecord(entry.payload) &&
          entry.payload.fastPath === true,
      ),
    ).toBe(true);
  });

  it("fails immediately when the relay socket disconnects during control events", async () => {
    const command: RpcSingleCommand = {
      jsonrpc: "2.0",
      method: "client_token.getPolicy",
      id: "client-request-1",
      params: {
        client_token: "client-token",
      },
    };

    await expect(
      executeRelayCommand({
        transport: new DisconnectRelayTransport(),
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject({
      code: "SOCKET_DISCONNECTED",
      retryable: true,
    });
  });
});
