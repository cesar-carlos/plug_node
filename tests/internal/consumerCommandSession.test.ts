import { describe, expect, it, vi } from "vitest";

import type {
  PlugSession,
  RelayConnectionReadyPayload,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { buildNodeOutputItems } from "../../packages/n8n-nodes-plug-database/generated/shared/output/nodeOutput";
import {
  buildConsumerSocketCapabilityProbeCommand,
  executeConsumerCommand,
  type ConsumerSocketTransport,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";

const readCommandRequestId = (payload: unknown, fallback = "request-1"): string =>
  typeof payload === "object" &&
  payload !== null &&
  typeof (payload as { readonly requestId?: unknown }).requestId === "string"
    ? (payload as { readonly requestId: string }).requestId
    : fallback;

const createControlledTransport = () => {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const transport: ConsumerSocketTransport = {
    connected: true,
    connect: () => undefined,
    disconnect: () => undefined,
    emit: vi.fn(),
    on: (event, handler) => {
      const listeners = handlers.get(event) ?? new Set();
      listeners.add(handler);
      handlers.set(event, listeners);
    },
    off: (event, handler) => {
      handlers.get(event)?.delete(handler);
    },
  };
  return {
    transport,
    dispatch: (event: string, payload: unknown): void => {
      for (const handler of handlers.get(event) ?? []) {
        handler(payload);
      }
    },
    listenerCount: (): number =>
      [...handlers.values()].reduce((count, listeners) => count + listeners.size, 0),
  };
};

const buildCommandSuccessResponse = (requestId: string) => ({
  success: true,
  requestId,
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

class SimpleConsumerTransport implements ConsumerSocketTransport {
  connected = false;

  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(private readonly emitUnmatchedResponse = false) {}

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
      const requestId = readCommandRequestId(payload);
      queueMicrotask(() => {
        if (this.emitUnmatchedResponse) {
          this.dispatch("agents:command_response", buildCommandSuccessResponse("stale"));
        }

        this.dispatch("agents:command_response", buildCommandSuccessResponse(requestId));
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

  emit(event: string, payload?: unknown): void {
    if (event === "agents:command") {
      const requestId =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { requestId?: unknown }).requestId === "string"
          ? (payload as { requestId: string }).requestId
          : "request-1";
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId,
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

  private requestId = "request-1";

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
      this.requestId = readCommandRequestId(payload);
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId: this.requestId,
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
          requestId: this.requestId,
          streamId: "stream-1",
          windowSize: 1,
        });

        if (pullNumber === 1) {
          this.dispatch("agents:command_stream_chunk", {
            request_id: "stale-request",
            stream_id: "stream-1",
            rows: [{ id: 999, name: "Stale" }],
          });
          this.dispatch("agents:command_stream_chunk", {
            request_id: this.requestId,
            stream_id: "stale-stream",
            rows: [{ id: 998, name: "Wrong Stream" }],
          });
          this.dispatch("agents:command_stream_complete", {
            request_id: "stale-request",
            stream_id: "stream-1",
            terminal_status: "completed",
          });
          this.dispatch("agents:command_stream_chunk", {
            request_id: this.requestId,
            stream_id: "stream-1",
            rows: [{ id: 2, name: "Beta" }],
          });
          return;
        }

        this.dispatch("agents:command_stream_chunk", {
          request_id: this.requestId,
          stream_id: "stream-1",
          rows: [{ id: 3, name: "Gamma" }],
        });
        this.dispatch("agents:command_stream_complete", {
          request_id: this.requestId,
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

class LargeChunkConsumerTransport implements ConsumerSocketTransport {
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
                rows: [],
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
          rows: Array.from({ length: 130_000 }, (_, index) => ({ id: index })),
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

class RateLimitedConsumerTransport implements ConsumerSocketTransport {
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

  emit(event: string, payload?: unknown): void {
    if (event === "agents:command") {
      const requestId =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { requestId?: unknown }).requestId === "string"
          ? (payload as { requestId: string }).requestId
          : "request-1";
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: false,
          requestId,
          error: {
            code: "TOO_MANY_REQUESTS",
            message: "slow down",
            statusCode: 429,
            retryAfterMs: 1250,
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

class ServiceUnavailableConsumerTransport implements ConsumerSocketTransport {
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

  emit(event: string, payload?: unknown): void {
    if (event === "agents:command") {
      const requestId =
        typeof payload === "object" &&
        payload !== null &&
        typeof (payload as { requestId?: unknown }).requestId === "string"
          ? (payload as { requestId: string }).requestId
          : "request-1";
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: false,
          requestId,
          error: {
            code: "SERVICE_UNAVAILABLE",
            message: "relay overloaded",
            retryAfterMs: 2500,
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
  it("should finish an active stream before a lost pull ack without an absolute deadline", async () => {
    vi.useFakeTimers();
    const controlled = createControlledTransport();
    try {
      const result = executeConsumerCommand({
        transport: controlled.transport,
        session,
        agentId: "agent-1",
        command: { jsonrpc: "2.0", method: "sql.execute", id: "active", params: {} },
        responseMode: "aggregatedJson",
        timeoutMs: 1_000,
      });
      await vi.advanceTimersByTimeAsync(5_500);
      controlled.dispatch("agents:command_response", {
        success: true,
        clientRequestId: "active",
        requestId: "hub",
        streamId: "stream",
        response: {
          type: "single",
          success: true,
          item: {
            id: "active",
            success: true,
            result: { rows: [], stream_id: "stream" },
          },
        },
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(controlled.transport.emit).toHaveBeenCalledWith(
        "agents:stream_pull",
        expect.anything(),
      );
      controlled.dispatch("agents:command_stream_chunk", {
        request_id: "hub",
        stream_id: "stream",
        rows: [{ index: 1 }],
      });
      await vi.advanceTimersByTimeAsync(700);
      controlled.dispatch("agents:command_stream_complete", {
        request_id: "hub",
        stream_id: "stream",
        terminal_status: "completed",
      });
      const response = await result;
      expect(response.notification).toBe(false);
      if (
        response.notification ||
        response.channel !== "socket" ||
        response.response.type !== "single"
      )
        throw new Error("Expected streamed rows");
      expect(response.response.item.result).toEqual(
        expect.objectContaining({ rows: [{ index: 1 }] }),
      );
      expect(controlled.listenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
      controlled.dispatch("agents:stream_pull_response", {
        success: true,
        requestId: "hub",
        streamId: "stream",
        windowSize: 256,
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(controlled.listenerCount()).toBe(0);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should time out when only unrelated commands produce socket activity", async () => {
    vi.useFakeTimers();
    const controlled = createControlledTransport();
    try {
      const result = executeConsumerCommand({
        transport: controlled.transport,
        session,
        agentId: "agent-1",
        command: {
          jsonrpc: "2.0",
          method: "sql.execute",
          id: "waiting-command",
          params: {},
        },
        responseMode: "aggregatedJson",
        timeoutMs: 1_000,
      });
      const rejected = expect(result).rejects.toMatchObject({ code: "PLUG_TIMEOUT" });
      await vi.advanceTimersByTimeAsync(500);
      controlled.dispatch(
        "agents:command_response",
        buildCommandSuccessResponse("another-command"),
      );
      controlled.dispatch("agents:command_stream_chunk", {
        request_id: "another-command",
        stream_id: "other-stream",
        rows: [],
      });
      controlled.dispatch("agents:command_stream_complete", {
        request_id: "another-command",
        stream_id: "other-stream",
        terminal_status: "completed",
      });
      await vi.advanceTimersByTimeAsync(5_500);
      await rejected;
      expect(controlled.listenerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("should preserve server timings when unrelated responses arrive during a stream", async () => {
    const controlled = createControlledTransport();
    const result = executeConsumerCommand({
      transport: controlled.transport,
      session,
      agentId: "agent-1",
      command: { jsonrpc: "2.0", method: "sql.execute", id: "own-command", params: {} },
      responseMode: "aggregatedJson",
      timeoutMs: 5_000,
    });
    await Promise.resolve();
    const ownTimings = { schemaVersion: 1, phasesMs: { encode_ms: 1 } };
    controlled.dispatch("agents:command_response", {
      ...buildCommandSuccessResponse("own-command"),
      streamId: "own-stream",
      serverTimings: ownTimings,
    });
    await Promise.resolve();
    controlled.dispatch("agents:stream_pull_response", {
      success: true,
      requestId: "own-command",
      streamId: "own-stream",
      windowSize: 32,
    });
    controlled.dispatch("agents:command_response", {
      ...buildCommandSuccessResponse("other-command"),
      serverTimings: { schemaVersion: 1, phasesMs: { encode_ms: 999 } },
    });
    await Promise.resolve();
    controlled.dispatch("agents:command_stream_complete", {
      request_id: "own-command",
      stream_id: "own-stream",
      terminal_status: "completed",
    });
    const resolved = await result;
    if (!resolved.notification) {
      expect(resolved.executionMetrics?.serverTimings).toEqual(ownTimings);
    }
    expect(controlled.listenerCount()).toBe(0);
  });
  it("returns normalized JSON for simple agents:command responses", async () => {
    const transport = new SimpleConsumerTransport();
    const result = await executeConsumerCommand({
      transport,
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
    expect(transport.emittedEvents[0].payload).toMatchObject({
      requestId: "request-1",
      clientRequestId: "request-1",
      agentId: "agent-1",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
      command: expect.objectContaining({
        id: "request-1",
      }),
    });
  });

  it("generates requestId and command.id when a single command omits id", async () => {
    const transport = new SimpleConsumerTransport();

    const result = await executeConsumerCommand({
      transport,
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        params: {
          client_token: "client-token",
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });
    const payload = transport.emittedEvents[0].payload as {
      readonly requestId: string;
      readonly clientRequestId: string;
      readonly command: { readonly id?: unknown };
    };

    expect(result.requestId).toBe(payload.requestId);
    expect(payload.requestId).toEqual(expect.any(String));
    expect(payload.clientRequestId).toBe(payload.requestId);
    expect(payload.command.id).toBe(payload.requestId);
  });

  it("ignores stale agents:command_response payloads that do not match requestId", async () => {
    const result = await executeConsumerCommand({
      transport: new SimpleConsumerTransport(true),
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

    expect(result.requestId).toBe("request-1");
    expect(result.response).toMatchObject({
      item: {
        result: {
          policy: "approved",
        },
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

  it("aggregates large agents:command chunks without spreading row arrays", async () => {
    const result = await executeConsumerCommand({
      transport: new LargeChunkConsumerTransport(),
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
      bufferLimits: {
        maxBufferedBytes: 20 * 1024 * 1024,
        maxBufferedChunkItems: 2,
        maxBufferedRows: 150_000,
      },
    });

    const items = buildNodeOutputItems(result, "aggregatedJson");

    expect(result.chunkPayloads).toHaveLength(0);
    expect(items).toHaveLength(130_000);
    expect(items[129_999]).toMatchObject({ id: 129_999 });
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

  it("enforces max chunk count for aggregated agents:command streams", async () => {
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
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
        payloadFrameCompression: "default",
        bufferLimits: {
          maxBufferedBytes: 1024 * 1024,
          maxBufferedChunkItems: 1,
          maxBufferedRows: 100,
        },
      }),
    ).rejects.toMatchObject({
      code: "SOCKET_BUFFER_LIMIT",
    });
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

  it("propagates retryAfterMs from agents:command_response failures", async () => {
    await expect(
      executeConsumerCommand({
        transport: new RateLimitedConsumerTransport(),
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
    ).rejects.toMatchObject({
      code: "TOO_MANY_REQUESTS",
      retryable: true,
      retryAfterSeconds: 2,
    });
  });

  it("marks SERVICE_UNAVAILABLE socket command failures as retryable", async () => {
    await expect(
      executeConsumerCommand({
        transport: new ServiceUnavailableConsumerTransport(),
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
    ).rejects.toMatchObject({
      code: "SERVICE_UNAVAILABLE",
      retryable: true,
      retryAfterSeconds: 3,
    });
  });

  it("includes connectedAfterMs on notification completions", async () => {
    const result = await executeConsumerCommand({
      transport: new NotificationConsumerTransport(),
      session,
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        method: "sql.executeBatch",
        id: null,
        params: {
          commands: [],
        },
      },
      responseMode: "aggregatedJson",
      timeoutMs: 5000,
      payloadFrameCompression: "default",
    });

    expect(result.notification).toBe(true);
    expect(result.executionMetrics?.connectedAfterMs).toBeGreaterThanOrEqual(0);
  });

  it("does not resolve twice when a late stale response arrives after success", async () => {
    const transport = new SimpleConsumerTransport(true);
    const result = await executeConsumerCommand({
      transport,
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

    expect(result.notification).toBe(false);
    if (result.notification) {
      return;
    }

    expect(result.requestId).toBe("request-1");
    expect(result.metrics?.ignoredCommandResponses).toBeGreaterThanOrEqual(1);
  });

  it("fails clearly when the socket disconnects before the command completes", async () => {
    class DisconnectMidCommandTransport implements ConsumerSocketTransport {
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
                user: { sub: "client-1", role: "client" },
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
        const eventHandlers = this.handlers.get(event) ?? new Set();
        eventHandlers.add(handler);
        this.handlers.set(event, eventHandlers);
      }

      off(event: string, handler: (payload: unknown) => void): void {
        this.handlers.get(event)?.delete(handler);
      }

      emit(event: string, payload?: unknown): void {
        if (event === "agents:command") {
          this.connected = false;
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

    await expect(
      executeConsumerCommand({
        transport: new DisconnectMidCommandTransport(),
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
    ).rejects.toMatchObject({
      code: "SOCKET_DISCONNECTED",
      retryable: true,
    });
  });
});
