import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";
import type {
  IBinaryData,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  ITriggerFunctions,
} from "n8n-workflow";

import { executePlugClientNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugClientExecution";
import type { PlugToolsSocketEventListenInput } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsCommon";
import { PlugDatabaseSocketEventTrigger } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabaseSocketEventTrigger/PlugDatabaseSocketEventTrigger.node";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

const loadFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/plug/${name}`, import.meta.url), "utf8"),
  ) as T;

const sharedCredentials = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
  agentId: "agent-1",
  clientToken: "client-token",
  payloadSigningKey: "sign-key",
  payloadSigningKeyId: "sign-key-id",
};

const socketMock = vi.hoisted(() => {
  type Handler = (payload: unknown) => void;

  class MockSocket {
    connected = false;
    readonly handlers = new Map<string, Set<Handler>>();

    connect(): void {
      this.connected = true;
      queueMicrotask(() => {
        this.dispatch(
          "connection:ready",
          encodePayloadFrame(
            {
              id: "socket-1",
              message: "ready",
              user: { sub: "client-1" },
            },
            { requestId: "handshake", compression: "none" },
          ),
        );
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

  const io = vi.fn(() => new MockSocket());

  return { io };
});

vi.mock("socket.io-client", () => ({
  io: socketMock.io,
}));

const createToolContext = (
  parameters: Record<string, unknown>,
): IExecuteFunctions & {
  readonly requests: IHttpRequestOptions[];
  readonly getCredentialsMock: ReturnType<typeof vi.fn>;
} => {
  const requests: IHttpRequestOptions[] = [];
  const httpRequest = vi.fn(async (request: IHttpRequestOptions) => {
    requests.push(request);
    if (String(request.url).endsWith("/client-auth/login")) {
      return {
        statusCode: 200,
        headers: {},
        body: loadFixture("login.success.json"),
      };
    }

    return {
      statusCode: 202,
      headers: {},
      body: {
        success: true,
        eventId: "event-1",
        eventName: "client:custom.status.changed",
        recipients: 1,
        requestId: "request-1",
        idempotencyKey: "publish-1",
        idempotentReplay: false,
      },
    };
  });
  const getCredentialsMock = vi.fn(async () => sharedCredentials);

  return {
    helpers: {
      httpRequest,
      prepareBinaryData: vi.fn(
        async (
          buffer: Buffer,
          fileName?: string,
          mimeType?: string,
        ): Promise<IBinaryData> => ({
          data: buffer.toString("base64"),
          fileName,
          mimeType,
        }),
      ),
      assertBinaryData: vi.fn(
        (): IBinaryData => ({
          data: "",
          fileName: "attachment.txt",
          mimeType: "text/plain",
        }),
      ),
      getBinaryDataBuffer: vi.fn(async () => Buffer.from("hello")),
    },
    continueOnFail: () => false,
    getCredentials: getCredentialsMock,
    getInputData: () => [{ json: { ok: true } } as INodeExecutionData],
    getNode: () => ({
      id: "plug-node",
      name: "Plug Database",
      type: "plugDatabase",
      typeVersion: 1,
      position: [0, 0] as [number, number],
      parameters: {},
    }),
    getNodeParameter: (name: string, itemIndex: number, fallbackValue?: unknown) => {
      if (name in parameters) {
        const value = parameters[name];
        if (Array.isArray(value)) {
          return value[itemIndex] ?? fallbackValue;
        }

        return value;
      }

      return fallbackValue;
    },
    requests,
    getCredentialsMock,
  } as unknown as IExecuteFunctions & {
    readonly requests: IHttpRequestOptions[];
    readonly getCredentialsMock: ReturnType<typeof vi.fn>;
  };
};

describe("shared Plug account credential coverage", () => {
  it("covers sql, client access, and user access with the same credential", async () => {
    const sqlContext = createMockExecuteContext({
      credentials: sharedCredentials,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: false,
        validateContextOptions: {
          timeoutMs: 5000,
        },
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("client-token-policy.success.json"),
        },
      ],
    }) as ReturnType<typeof createMockExecuteContext> & {
      getCredentials: ReturnType<typeof vi.fn>;
    };

    await executePlugClientNode(sqlContext, {
      supportsSocket: false,
      credentialName: "plugDatabaseAccountApi",
    });

    expect(sqlContext.getCredentials).toHaveBeenCalledWith("plugDatabaseAccountApi");
    expect(sqlContext.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      agentId: "agent-1",
      command: {
        params: {
          client_token: "client-token",
        },
      },
    });

    const clientAccessContext = createMockExecuteContext({
      credentials: sharedCredentials,
      parameters: {
        resource: "clientAccess",
        operation: "listClientAgents",
        includePlugMetadata: false,
        status: "active",
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agents: [],
            agentIds: [],
            count: 0,
            total: 0,
            page: 1,
            pageSize: 50,
          },
        },
      ],
    }) as ReturnType<typeof createMockExecuteContext> & {
      getCredentials: ReturnType<typeof vi.fn>;
    };

    await executePlugClientNode(clientAccessContext, {
      supportsSocket: false,
      credentialName: "plugDatabaseAccountApi",
    });

    expect(clientAccessContext.getCredentials).toHaveBeenCalledWith(
      "plugDatabaseAccountApi",
    );

    const userAccessContext = createMockExecuteContext({
      credentials: sharedCredentials,
      parameters: {
        resource: "userAccess",
        operation: "listAgentCatalog",
        includePlugMetadata: false,
        status: "active",
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: {
            accessToken: "access-1",
            refreshToken: "refresh-1",
            user: {
              id: "user-1",
              email: "owner@example.com",
              role: "user",
            },
          },
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agents: [],
            count: 0,
            total: 0,
            page: 1,
            pageSize: 50,
          },
        },
      ],
    }) as ReturnType<typeof createMockExecuteContext> & {
      getCredentials: ReturnType<typeof vi.fn>;
    };

    await executePlugClientNode(userAccessContext, {
      supportsSocket: false,
      credentialName: "plugDatabaseAccountApi",
    });

    expect(userAccessContext.getCredentials).toHaveBeenCalledWith(
      "plugDatabaseAccountApi",
    );
  });

  it("covers public publish and advanced wait with the same credential", async () => {
    const publishContext = createToolContext({
      resource: "tools",
      operation: "publishSocketEvent",
      publishChannel: "rest",
      eventName: "client:custom.status.changed",
      payloadJson: '{"status":"ready"}',
      payloadFrameCompression: "default",
      idempotencyKey: "publish-1",
      timeoutMs: 15000,
      includePlugMetadata: true,
      attachments: {},
    });

    await executePlugClientNode(publishContext, {
      supportsSocket: false,
      credentialName: "plugDatabaseAccountApi",
      nodeDisplayName: "Plug Database",
    });

    expect(publishContext.getCredentialsMock).toHaveBeenCalledWith(
      "plugDatabaseAccountApi",
    );

    const socketEventListener = vi.fn(async (input: PlugToolsSocketEventListenInput) => {
      expect(input.payloadFrameSigning).toEqual({
        key: "sign-key",
        keyId: "sign-key-id",
      });
      return {
        event: {
          eventId: "event-listen-1",
          eventName: input.eventName,
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [],
        },
        metadata: {
          eventName: input.eventName,
          socketId: "socket-1",
          reconnectAttempt: 0,
          subscriptionCount: 1,
          payloadFrameRequestId: "frame-1",
        },
      };
    });
    const waitContext = createToolContext({
      resource: "tools",
      operation: "waitForSocketEvent",
      eventName: "client:custom.status.changed",
      listenTimeoutMs: 5000,
      socketAckTimeoutMs: 2000,
      binaryPropertyPrefix: "attachment",
      requirePayloadSignature: true,
      includePlugMetadata: true,
    });

    await executePlugClientNode(waitContext, {
      supportsSocket: true,
      credentialName: "plugDatabaseAccountApi",
      nodeDisplayName: "Plug Database",
      socketEventListener,
    });

    expect(waitContext.getCredentialsMock).toHaveBeenCalledWith("plugDatabaseAccountApi");
    expect(socketEventListener).toHaveBeenCalledOnce();
  });

  it("covers the Socket Event trigger with the same credential name", async () => {
    const getCredentials = vi.fn(async () => sharedCredentials);
    const httpRequest = vi.fn(async (request: IHttpRequestOptions) => {
      if (String(request.url).endsWith("/client-auth/login")) {
        return {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        };
      }

      throw new Error(`Unexpected request ${request.url}`);
    });
    const node = new PlugDatabaseSocketEventTrigger();
    const context = {
      getCredentials,
      getNodeParameter: vi.fn((name: string, fallback?: unknown) => {
        const parameters: Record<string, unknown> = {
          eventNames: {
            values: [{ eventName: "client:custom.status.changed" }],
          },
          eventSource: "customEvents",
          ackTimeoutMs: 1000,
          manualListenTimeoutMs: 0,
          binaryPropertyPrefix: "attachment",
          includePlugMetadata: true,
          reconnectOnDisconnect: false,
          maxReconnectAttempts: 0,
          reconnectFailureWindowMs: 300000,
          maxReconnectFailuresInWindow: 0,
          reconnectInitialDelayMs: 100,
          reconnectMaxDelayMs: 100,
          maxInflightEvents: 8,
          maxQueueSize: 128,
          overflowPolicy: "fail",
          requirePayloadSignature: false,
          requirePayloadSignatureFor: "all",
          deduplicateEvents: false,
          deduplicationTtlMs: 300000,
        };

        return parameters[name] ?? fallback;
      }),
      getMode: () => "manual",
      emit: vi.fn(),
      emitError: vi.fn(),
      helpers: {
        httpRequest,
        prepareBinaryData: vi.fn(
          async (
            buffer: Buffer,
            fileName?: string,
            mimeType?: string,
          ): Promise<IBinaryData> => ({
            data: buffer.toString("base64"),
            fileName,
            mimeType,
          }),
        ),
      },
    } as unknown as ITriggerFunctions;

    const response = await node.trigger.call(context);

    expect(getCredentials).toHaveBeenCalledWith("plugDatabaseAccountApi");
    await response.closeFunction?.();
  });
});
