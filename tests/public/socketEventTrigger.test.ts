import { describe, expect, it, vi } from "vitest";
import type { IBinaryData, ITriggerFunctions, IHttpRequestOptions } from "n8n-workflow";

import { PlugDatabaseAdvancedSocketEventTrigger } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

const socketMock = vi.hoisted(() => {
  type Handler = (payload: unknown) => void;

  const state: {
    connectErrorsBeforeReady: number;
    readyFrame?: unknown;
    sockets: MockSocket[];
  } = {
    connectErrorsBeforeReady: 0,
    sockets: [],
  };

  class MockSocket {
    connected = false;
    readonly handlers = new Map<string, Set<Handler>>();
    readonly emittedEvents: Array<{
      readonly event: string;
      readonly payload?: unknown;
    }> = [];

    constructor(
      readonly url: string,
      readonly options: Record<string, unknown>,
    ) {}

    connect(): void {
      if (state.connectErrorsBeforeReady > 0) {
        state.connectErrorsBeforeReady -= 1;
        queueMicrotask(() => {
          this.dispatch("connect_error", new Error("temporary unavailable"));
        });
        return;
      }

      this.connected = true;
      queueMicrotask(() => {
        this.dispatch("connection:ready", state.readyFrame);
      });
    }

    disconnect(): void {
      this.connected = false;
    }

    on(event: string, handler: Handler): void {
      const handlers = this.handlers.get(event) ?? new Set<Handler>();
      handlers.add(handler);
      this.handlers.set(event, handlers);
    }

    off(event: string, handler: Handler): void {
      this.handlers.get(event)?.delete(handler);
    }

    emit(event: string, payload?: unknown): void {
      this.emittedEvents.push({ event, payload });
      if (event === "socket:event.subscribe") {
        const request = payload as {
          readonly requestId: string;
          readonly eventName: string;
        };
        queueMicrotask(() => {
          this.dispatch("socket:event.subscribed", {
            success: true,
            requestId: request.requestId,
            data: {
              eventName: request.eventName,
              subscribed: true,
            },
          });
        });
      }

      if (event === "socket:event.unsubscribe") {
        const request = payload as {
          readonly requestId: string;
          readonly eventName: string;
        };
        queueMicrotask(() => {
          this.dispatch("socket:event.unsubscribed", {
            success: true,
            requestId: request.requestId,
            data: {
              eventName: request.eventName,
              subscribed: false,
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

  const io = vi.fn((url: string, options: Record<string, unknown>) => {
    const socket = new MockSocket(url, options);
    state.sockets.push(socket);
    return socket;
  });

  return {
    io,
    state,
  };
});

vi.mock("socket.io-client", () => ({
  io: socketMock.io,
}));

const credentials = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
  agentId: "agent-1",
  clientToken: "client-token",
  payloadSigningKey: "",
  payloadSigningKeyId: "",
};

const createContext = (
  overrides?: Partial<Record<string, unknown>>,
): ITriggerFunctions => {
  const emit = vi.fn();
  const emitError = vi.fn();
  const httpRequest = vi.fn(async (request: IHttpRequestOptions) => {
    if (String(request.url).endsWith("/client-auth/login")) {
      return {
        statusCode: 200,
        headers: {},
        body: {
          accessToken: `access-${httpRequest.mock.calls.length}`,
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
    }

    throw new Error(`Unexpected request ${request.url}`);
  });

  const parameters: Record<string, unknown> = {
    eventNames: {
      values: [
        { eventName: "client:custom.status.changed" },
        { eventName: "client:custom.invoice.created" },
      ],
    },
    eventSource: "customEvents",
    ackTimeoutMs: 1000,
    manualListenTimeoutMs: 0,
    binaryPropertyPrefix: "attachment",
    includePlugMetadata: true,
    reconnectOnDisconnect: true,
    maxReconnectAttempts: 1,
    reconnectInitialDelayMs: 100,
    reconnectMaxDelayMs: 100,
    maxInflightEvents: 8,
    maxQueueSize: 128,
    overflowPolicy: "fail",
    requirePayloadSignature: false,
    ...overrides,
  };

  return {
    getCredentials: vi.fn(async () => credentials),
    getNodeParameter: vi.fn(
      (name: string, fallback?: unknown) => parameters[name] ?? fallback,
    ),
    getMode: () => "trigger",
    emit,
    emitError,
    helpers: {
      httpRequest,
      prepareBinaryData: vi.fn(
        async (
          data: Buffer,
          fileName?: string,
          mimeType?: string,
        ): Promise<IBinaryData> => ({
          data: data.toString("base64"),
          fileName,
          mimeType,
        }),
      ),
    },
    __emit: emit,
    __emitError: emitError,
  } as unknown as ITriggerFunctions;
};

describe("PlugDatabaseAdvancedSocketEventTrigger", () => {
  it("connects to /consumers, subscribes to multiple events, emits items, and cleans up", async () => {
    socketMock.state.sockets = [];
    socketMock.state.connectErrorsBeforeReady = 0;
    socketMock.state.readyFrame = encodePayloadFrame(
      {
        id: "socket-1",
        message: "ready",
        user: { sub: "client-1" },
      },
      { requestId: "handshake", compression: "none" },
    );
    const node = new PlugDatabaseAdvancedSocketEventTrigger();
    const context = createContext();

    const response = await node.trigger.call(context);
    const socket = socketMock.state.sockets[0];

    expect(socketMock.io).toHaveBeenCalledWith(
      "https://plug-server.example.com/consumers",
      expect.objectContaining({
        auth: {
          token: "access-1",
        },
        transports: ["websocket"],
      }),
    );
    expect(
      socket.emittedEvents.filter(({ event }) => event === "socket:event.subscribe"),
    ).toHaveLength(2);

    socket.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-1",
          eventName: "client:custom.status.changed",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [
            {
              fieldName: "files",
              originalName: "hello.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
              base64: Buffer.from("hello").toString("base64"),
            },
          ],
        },
        { requestId: "event-1", compression: "none" },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const emit = (context as unknown as { __emit: ReturnType<typeof vi.fn> }).__emit;
    expect(emit).toHaveBeenCalledWith([
      [
        expect.objectContaining({
          json: expect.objectContaining({
            eventId: "event-1",
            __plug: expect.objectContaining({
              channel: "socket",
              socketMode: "customEvent",
              eventName: "client:custom.status.changed",
              payloadFrameRequestId: "event-1",
              subscriptionCount: 2,
            }),
            attachments: [
              {
                fieldName: "files",
                originalName: "hello.txt",
                mimeType: "text/plain",
                sizeBytes: 5,
              },
            ],
          }),
          binary: expect.objectContaining({
            attachment_0: expect.objectContaining({
              fileName: "hello.txt",
            }),
          }),
        }),
      ],
    ]);

    await response.closeFunction?.();
    expect(
      socket.emittedEvents.filter(({ event }) => event === "socket:event.unsubscribe"),
    ).toHaveLength(2);
    expect(socket.connected).toBe(false);
  });

  it("reconnects and re-subscribes after retryable disconnects", async () => {
    vi.useFakeTimers();
    try {
      socketMock.state.sockets = [];
      socketMock.state.connectErrorsBeforeReady = 0;
      socketMock.state.readyFrame = encodePayloadFrame(
        {
          id: "socket-1",
          message: "ready",
          user: { sub: "client-1" },
        },
        { requestId: "handshake", compression: "none" },
      );
      const node = new PlugDatabaseAdvancedSocketEventTrigger();
      const context = createContext();

      const response = await node.trigger.call(context);
      socketMock.state.sockets[0].dispatch("disconnect", "transport close");
      await vi.advanceTimersByTimeAsync(150);

      expect(socketMock.state.sockets).toHaveLength(2);
      expect(
        socketMock.state.sockets[1].emittedEvents.filter(
          ({ event }) => event === "socket:event.subscribe",
        ),
      ).toHaveLength(2);
      expect(
        (context as unknown as { __emitError: ReturnType<typeof vi.fn> }).__emitError,
      ).not.toHaveBeenCalled();

      await response.closeFunction?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries initial activation after transient connect_error", async () => {
    vi.useFakeTimers();
    try {
      socketMock.state.sockets = [];
      socketMock.state.connectErrorsBeforeReady = 1;
      socketMock.state.readyFrame = encodePayloadFrame(
        {
          id: "socket-1",
          message: "ready",
          user: { sub: "client-1" },
        },
        { requestId: "handshake", compression: "none" },
      );
      const node = new PlugDatabaseAdvancedSocketEventTrigger();
      const context = createContext({
        maxReconnectAttempts: 2,
      });

      const triggerPromise = node.trigger.call(context);
      await vi.advanceTimersByTimeAsync(250);
      const response = await triggerPromise;

      expect(socketMock.state.sockets).toHaveLength(2);
      expect(
        socketMock.state.sockets[1].emittedEvents.filter(
          ({ event }) => event === "socket:event.subscribe",
        ),
      ).toHaveLength(2);

      await response.closeFunction?.();
    } finally {
      vi.useRealTimers();
    }
  });

  it("listens for agent profile updates without custom subscriptions", async () => {
    socketMock.state.sockets = [];
    socketMock.state.connectErrorsBeforeReady = 0;
    socketMock.state.readyFrame = encodePayloadFrame(
      {
        id: "socket-1",
        message: "ready",
        user: { sub: "client-1" },
      },
      { requestId: "handshake", compression: "none" },
    );
    const node = new PlugDatabaseAdvancedSocketEventTrigger();
    const context = createContext({
      eventSource: "agentProfileUpdated",
    });

    const response = await node.trigger.call(context);
    const socket = socketMock.state.sockets[0];
    expect(
      socket.emittedEvents.filter(({ event }) => event === "socket:event.subscribe"),
    ).toHaveLength(0);

    socket.dispatch(
      "client:agent.profile.updated",
      encodePayloadFrame(
        {
          success: true,
          agentId: "agent-1",
          profileVersion: 2,
          profileUpdatedAt: "2026-05-11T12:00:00.000Z",
          changedFields: ["displayName"],
        },
        { requestId: "profile-1", compression: "none" },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    const emit = (context as unknown as { __emit: ReturnType<typeof vi.fn> }).__emit;
    expect(emit).toHaveBeenCalledWith([
      [
        expect.objectContaining({
          json: expect.objectContaining({
            eventName: "client:agent.profile.updated",
            payload: expect.objectContaining({
              agentId: "agent-1",
              profileVersion: 2,
            }),
            __plug: expect.objectContaining({
              socketMode: "agentProfileUpdated",
              payloadFrameRequestId: "profile-1",
            }),
          }),
        }),
      ],
    ]);

    await response.closeFunction?.();
    expect(socket.connected).toBe(false);
  });

  it("does not emit an event after the trigger is closed while binary data is being prepared", async () => {
    socketMock.state.sockets = [];
    socketMock.state.connectErrorsBeforeReady = 0;
    socketMock.state.readyFrame = encodePayloadFrame(
      {
        id: "socket-1",
        message: "ready",
        user: { sub: "client-1" },
      },
      { requestId: "handshake", compression: "none" },
    );
    const node = new PlugDatabaseAdvancedSocketEventTrigger();
    const context = createContext();
    let releasePrepare: (() => void) | undefined;
    const prepareStarted = new Promise<void>((resolve) => {
      (
        context.helpers.prepareBinaryData as unknown as ReturnType<typeof vi.fn>
      ).mockImplementationOnce(
        async (
          data: Buffer,
          fileName?: string,
          mimeType?: string,
        ): Promise<IBinaryData> => {
          resolve();
          await new Promise<void>((release) => {
            releasePrepare = release;
          });
          return {
            data: data.toString("base64"),
            fileName,
            mimeType,
          };
        },
      );
    });

    const response = await node.trigger.call(context);
    const socket = socketMock.state.sockets[0];
    socket.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-1",
          eventName: "client:custom.status.changed",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [
            {
              fieldName: "files",
              originalName: "hello.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
              base64: Buffer.from("hello").toString("base64"),
            },
          ],
        },
        { requestId: "event-1", compression: "none" },
      ),
    );

    await prepareStarted;
    await response.closeFunction?.();
    releasePrepare?.();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(
      (context as unknown as { __emit: ReturnType<typeof vi.fn> }).__emit,
    ).not.toHaveBeenCalled();
  });
});
