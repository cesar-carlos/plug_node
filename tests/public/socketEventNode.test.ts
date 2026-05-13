import { describe, expect, it, vi } from "vitest";
import type { IBinaryData, IExecuteFunctions, IHttpRequestOptions } from "n8n-workflow";

import { PlugDatabaseAdvanced } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node";
import { PlugDatabaseAdvancedSocketEvent } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

const socketMock = vi.hoisted(() => {
  type Handler = (payload: unknown) => void;

  const state: {
    listenFrame?: unknown;
    readyFrame?: unknown;
    sockets: MockSocket[];
  } = {
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

    get id(): string {
      return "socket-1";
    }

    connect(): void {
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
      if (event === "socket:event.publish") {
        const request = payload as {
          readonly requestId: string;
          readonly eventName: string;
          readonly idempotencyKey?: string;
        };
        queueMicrotask(() => {
          this.dispatch("socket:event.published", {
            success: true,
            requestId: request.requestId,
            data: {
              eventId: "event-1",
              eventName: request.eventName,
              recipients: 4,
              idempotencyKey: request.idempotencyKey,
              idempotentReplay: false,
            },
          });
        });
      }

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
          if (state.listenFrame !== undefined) {
            this.dispatch(request.eventName, state.listenFrame);
          }
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

const createContext = (options?: {
  readonly continueOnFail?: boolean;
  readonly publishStatusCode?: number;
  readonly publishBody?: unknown;
  readonly binaryBuffer?: Buffer;
  readonly parameters?: Record<string, unknown>;
}): IExecuteFunctions => {
  const requests: IHttpRequestOptions[] = [];
  const httpRequest = vi.fn(async (request: IHttpRequestOptions) => {
    requests.push(request);
    if (String(request.url).endsWith("/client-auth/login")) {
      return {
        statusCode: 200,
        headers: {},
        body: {
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
    }

    return {
      statusCode: options?.publishStatusCode ?? 202,
      headers: {},
      body: options?.publishBody ?? {
        success: true,
        eventId: "event-1",
        eventName: "client:custom.status.changed",
        recipients: 3,
        idempotencyKey: "publish-1",
        idempotentReplay: false,
        requestId: "req-1",
      },
    };
  });

  return {
    getInputData: () => [{ json: {} }],
    getNode: () => ({
      id: "node-1",
      name: "Plug Socket Event",
      type: "n8n-nodes-plug-database-advanced.plugDatabaseAdvancedSocketEvent",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    }),
    getCredentials: vi.fn(async () => credentials),
    getNodeParameter: vi.fn((name: string) => {
      const parameters: Record<string, unknown> = {
        publishChannel: "rest",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
        timeoutMs: 15000,
        includePlugMetadata: true,
        attachments: {},
        ...options?.parameters,
      };
      return parameters[name];
    }),
    continueOnFail: () => options?.continueOnFail ?? false,
    helpers: {
      httpRequest,
      assertBinaryData: vi.fn(
        (_itemIndex: number, propertyName: string): IBinaryData => ({
          data: "",
          fileName: `${propertyName}.txt`,
          mimeType: "text/plain",
        }),
      ),
      getBinaryDataBuffer: vi.fn(
        async () => options?.binaryBuffer ?? Buffer.from("hello"),
      ),
      prepareBinaryData: vi.fn(
        async (
          buffer: Buffer,
          fileName?: string,
          mimeType?: string,
        ): Promise<IBinaryData> => ({
          data: buffer.toString("base64"),
          fileName,
          mimeType,
          fileSize: String(buffer.length),
        }),
      ),
    },
    __requests: requests,
  } as unknown as IExecuteFunctions;
};

describe("PlugDatabaseAdvancedSocketEvent", () => {
  it("publishes custom socket events through the REST endpoint", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext();

    const output = await node.execute.call(context);
    const requests = (context as unknown as { __requests: IHttpRequestOptions[] })
      .__requests;
    const publishRequest = requests[1];

    expect(output[0][0].json).toMatchObject({
      success: true,
      eventId: "event-1",
      recipients: 3,
      requestId: "req-1",
      idempotentReplay: false,
      __plug: {
        channel: "rest",
        operation: "publishCustomSocketEvent",
        requestId: "req-1",
        idempotentReplay: false,
        deliveryStatus: "delivered",
      },
    });
    expect(publishRequest).toMatchObject({
      method: "POST",
      url: "https://plug-server.example.com/api/v1/client/me/socket-events",
      body: {
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        payloadFrameCompression: "default",
      },
    });
    expect(publishRequest.headers).toMatchObject({
      authorization: "Bearer access-1",
      "idempotency-key": "publish-1",
    });
  });

  it("serializes publish errors when continueOnFail is enabled", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      continueOnFail: true,
      publishStatusCode: 409,
      publishBody: {
        code: "IDEMPOTENCY_CONFLICT",
        message: "key reused",
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      code: "IDEMPOTENCY_CONFLICT",
      statusCode: 409,
    });
  });

  it("publishes REST multipart events when attachments are configured", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      parameters: {
        attachments: {
          values: [{ binaryPropertyName: "invoice" }],
        },
      },
    });

    await node.execute.call(context);
    const requests = (context as unknown as { __requests: IHttpRequestOptions[] })
      .__requests;
    const publishRequest = requests[1];

    expect(publishRequest).toMatchObject({
      method: "POST",
      url: "https://plug-server.example.com/api/v1/client/me/socket-events",
    });
    expect(publishRequest.body).toBeInstanceOf(FormData);
    const formEntries = Array.from((publishRequest.body as FormData).entries());
    expect(formEntries[0]).toEqual([
      "event",
      JSON.stringify({
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        payloadFrameCompression: "default",
      }),
    ]);
    expect(formEntries[1][0]).toBe("files");
    expect((formEntries[1][1] as File).name).toBe("invoice.txt");
    expect((formEntries[1][1] as File).size).toBe(5);
    expect(publishRequest.headers).toMatchObject({
      authorization: "Bearer access-1",
      "idempotency-key": "publish-1",
    });
  });

  it("rejects invalid publish channel values instead of falling back to REST", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      continueOnFail: true,
      parameters: {
        publishChannel: "invalid-channel",
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      message: "Publish Channel must be REST or Socket",
      name: "NodeOperationError",
    });
    expect(
      (context as unknown as { __requests: IHttpRequestOptions[] }).__requests,
    ).toHaveLength(0);
  });

  it("validates timeout values before publishing multipart events", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      continueOnFail: true,
      parameters: {
        timeoutMs: "not-a-number",
        attachments: {
          values: [{ binaryPropertyName: "invoice" }],
        },
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      message: "Timeout (MS) must be a positive number",
      name: "NodeOperationError",
    });
    expect(
      (context as unknown as { __requests: IHttpRequestOptions[] }).__requests,
    ).toHaveLength(0);
  });

  it("rejects payload JSON above the local server-aligned size limit", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      continueOnFail: true,
      parameters: {
        payloadJson: JSON.stringify("x".repeat(524_288)),
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      message: "Payload JSON must be at most 524288 bytes",
      name: "NodeOperationError",
    });
    expect(
      (context as unknown as { __requests: IHttpRequestOptions[] }).__requests,
    ).toHaveLength(0);
  });

  it("rejects attachments above the local per-file size limit", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      continueOnFail: true,
      binaryBuffer: Buffer.alloc(524_289),
      parameters: {
        attachments: {
          values: [{ binaryPropertyName: "invoice" }],
        },
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      message: "Attachment invoice.txt must be at most 524288 bytes",
      name: "NodeOperationError",
    });
    expect(
      (context as unknown as { __requests: IHttpRequestOptions[] }).__requests,
    ).toHaveLength(0);
  });

  it("accepts multipart attachments at the local per-file size limit", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      binaryBuffer: Buffer.alloc(524_288),
      parameters: {
        attachments: {
          values: [{ binaryPropertyName: "invoice" }],
        },
      },
    });

    await node.execute.call(context);
    const requests = (context as unknown as { __requests: IHttpRequestOptions[] })
      .__requests;
    const formEntries = Array.from((requests[1].body as FormData).entries());

    expect((formEntries[1][1] as File).size).toBe(524_288);
  });

  it("returns a user-safe error when a successful publish response has invalid JSON", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      continueOnFail: true,
      publishBody: "{invalid-json",
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "Plug socket event publish response body must be valid JSON",
    });
  });

  it("flags noRecipients in publish metadata when the server accepts the event but no listener matches", async () => {
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      publishBody: {
        success: true,
        eventId: "event-0",
        eventName: "client:custom.status.changed",
        recipients: 0,
        idempotencyKey: "publish-0",
        idempotentReplay: false,
        requestId: "req-0",
      },
    });

    const output = await node.execute.call(context);

    expect(output[0][0].json).toMatchObject({
      recipients: 0,
      requestId: "req-0",
      __plug: {
        recipients: 0,
        requestId: "req-0",
        deliveryStatus: "noRecipients",
      },
    });
  });

  it("publishes events through the Socket channel", async () => {
    socketMock.state.sockets = [];
    socketMock.state.listenFrame = undefined;
    socketMock.state.readyFrame = encodePayloadFrame(
      {
        id: "socket-1",
        message: "ready",
        user: { sub: "client-1" },
      },
      { requestId: "handshake", compression: "none" },
    );
    const node = new PlugDatabaseAdvancedSocketEvent();
    const context = createContext({
      parameters: {
        publishChannel: "socket",
        attachments: {
          values: [{ binaryPropertyName: "invoice" }],
        },
      },
    });

    const output = await node.execute.call(context);
    const socket = socketMock.state.sockets[0];

    expect(output[0][0].json).toMatchObject({
      success: true,
      eventId: "event-1",
      recipients: 4,
      requestId: expect.any(String),
      idempotentReplay: false,
      publisherSocketId: "socket-1",
      __plug: {
        channel: "socket",
        requestId: expect.any(String),
        idempotentReplay: false,
        deliveryStatus: "delivered",
        attachmentCount: 1,
        publisherSocketId: "socket-1",
      },
    });
    expect(socketMock.io).toHaveBeenCalledWith(
      "https://plug-server.example.com/consumers",
      expect.objectContaining({
        auth: {
          token: "access-1",
        },
        transports: ["websocket"],
      }),
    );
    expect(socket.emittedEvents).toEqual([
      expect.objectContaining({
        event: "socket:event.publish",
        payload: expect.objectContaining({
          eventName: "client:custom.status.changed",
          attachments: [
            expect.objectContaining({
              originalName: "invoice.txt",
              base64: Buffer.from("hello").toString("base64"),
            }),
          ],
        }),
      }),
    ]);
    expect(socket.connected).toBe(false);
  });

  it("waits for one socket event through the advanced consolidated node", async () => {
    socketMock.state.sockets = [];
    socketMock.state.readyFrame = encodePayloadFrame(
      {
        id: "socket-1",
        message: "ready",
        user: { sub: "client-1" },
      },
      { requestId: "handshake", compression: "none" },
    );
    socketMock.state.listenFrame = encodePayloadFrame(
      {
        eventId: "event-listen-1",
        eventName: "client:custom.status.changed",
        emittedAt: "2026-05-11T12:00:00.000Z",
        publisher: { principalType: "client", clientId: "client-1" },
        payload: { status: "ready" },
        attachments: [
          {
            fieldName: "files",
            originalName: "invoice.txt",
            mimeType: "text/plain",
            sizeBytes: 5,
            base64: Buffer.from("hello").toString("base64"),
          },
        ],
      },
      { requestId: "event-listen-1", compression: "none" },
    );
    const node = new PlugDatabaseAdvanced();
    const context = createContext({
      parameters: {
        resource: "tools",
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 5000,
        socketAckTimeoutMs: 2000,
        binaryPropertyPrefix: "eventFile",
        requirePayloadSignature: false,
        includePlugMetadata: true,
      },
    });

    const output = await node.execute.call(context);
    const socket = socketMock.state.sockets[0];

    expect(output[0][0].json).toMatchObject({
      eventId: "event-listen-1",
      eventName: "client:custom.status.changed",
      payload: { status: "ready" },
      __plug: {
        channel: "socket",
        operation: "waitForSocketEvent",
        socketId: "socket-1",
        payloadFrameRequestId: "event-listen-1",
        subscriptionCount: 1,
        attachmentCount: 1,
      },
    });
    expect(output[0][0].binary?.eventFile_0).toMatchObject({
      data: Buffer.from("hello").toString("base64"),
      fileName: "invoice.txt",
      mimeType: "text/plain",
    });
    expect(socketMock.io).toHaveBeenCalledWith(
      "https://plug-server.example.com/consumers",
      expect.objectContaining({
        auth: {
          token: "access-1",
        },
        transports: ["websocket"],
      }),
    );
    expect(socket.emittedEvents).toEqual([
      expect.objectContaining({
        event: "socket:event.subscribe",
        payload: expect.objectContaining({
          eventName: "client:custom.status.changed",
        }),
      }),
      expect.objectContaining({
        event: "socket:event.unsubscribe",
        payload: expect.objectContaining({
          eventName: "client:custom.status.changed",
        }),
      }),
    ]);
    expect(socket.connected).toBe(false);
  });
});
