import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";
import type {
  IBinaryData,
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { defaultCustomSocketEventPayloadJsonMaxBytes } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/custom-socket-events";
import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  executePlugToolsSocketEventNode,
  type PlugToolsSocketEventListenInput,
  type PlugToolsSocketEventPublishInput,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsExecution";

const defaultNode: INode = {
  id: "plug-tools-socket-node",
  name: "Plug Tools Socket",
  type: "plugTools",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

interface ToolContextOptions {
  readonly parameters: Record<string, unknown>;
  readonly inputData?: INodeExecutionData[];
  readonly publishStatusCode?: number;
  readonly publishBody?: unknown;
  readonly binaryBuffer?: Buffer;
  readonly credentials?: {
    readonly payloadSigningKey?: string;
    readonly payloadSigningKeyId?: string;
  };
}

const createToolContext = (
  options: ToolContextOptions,
): IExecuteFunctions & {
  readonly requests: IHttpRequestOptions[];
} => {
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
      statusCode: options.publishStatusCode ?? 202,
      headers: {},
      body: options.publishBody ?? {
        success: true,
        eventId: "event-1",
        eventName: "client:custom.status.changed",
        recipients: 2,
        idempotencyKey: "publish-1",
        idempotentReplay: false,
        requestId: "request-1",
      },
    };
  });

  const context = {
    helpers: {
      prepareBinaryData: vi.fn(),
      httpRequest,
      assertBinaryData: vi.fn(
        (_itemIndex: number, propertyName: string): IBinaryData => ({
          data: "",
          fileName: `${propertyName}.txt`,
          mimeType: "text/plain",
        }),
      ),
      getBinaryDataBuffer: vi.fn(
        async () => options.binaryBuffer ?? Buffer.from("attachment"),
      ),
    },
    continueOnFail: () => false,
    getCredentials: vi.fn(async () => ({
      user: "client@example.com",
      password: "secret",
      baseUrl: "https://plug-server.example.com/api/v1",
      agentId: "agent-1",
      clientToken: "client-token",
      payloadSigningKey: options.credentials?.payloadSigningKey ?? "",
      payloadSigningKeyId: options.credentials?.payloadSigningKeyId ?? "",
    })),
    getInputData: () => options.inputData ?? [{ json: { input: true } }],
    getNode: () => defaultNode,
    getNodeParameter: (
      name: string,
      itemIndex: number,
      fallbackValue?: unknown,
    ): unknown => {
      if (name in options.parameters) {
        const value = options.parameters[name];
        if (Array.isArray(value)) {
          return value[itemIndex] ?? fallbackValue;
        }

        return value;
      }

      return fallbackValue;
    },
    requests,
  };

  return context as unknown as IExecuteFunctions & {
    readonly requests: IHttpRequestOptions[];
  };
};

describe("executePlugToolsSocketEventNode", () => {
  it("publishes a socket event over REST", async () => {
    const context = createToolContext({
      parameters: {
        operation: "publishSocketEvent",
        publishChannel: "rest",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
        timeoutMs: 15000,
        includePlugMetadata: true,
        attachments: {},
      },
    });

    const output = await executePlugToolsSocketEventNode(context, {
      credentialName: "plugDatabaseAccountApi",
      nodeDisplayName: "Plug Database Tools",
    });

    expect(output[0][0].json).toMatchObject({
      success: true,
      eventId: "event-1",
      __plug: {
        channel: "rest",
        operation: "publishCustomSocketEvent",
        deliveryStatus: "delivered",
      },
    });
    expect(context.requests[1]).toMatchObject({
      method: "POST",
      url: "https://plug-server.example.com/api/v1/client/me/socket-events",
      body: {
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
      },
    });
  });

  it("publishes through an injected socket publisher", async () => {
    const socketEventPublisher = vi.fn(
      async (input: PlugToolsSocketEventPublishInput) => ({
        success: true,
        eventId: "socket-event-1",
        eventName: input.eventName,
        recipients: 0,
        idempotentReplay: false,
        requestId: "socket-request-1",
      }),
    );
    const context = createToolContext({
      parameters: {
        operation: "publishSocketEvent",
        publishChannel: "socket",
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "none",
        socketAckTimeoutMs: 2000,
        attachments: {},
      },
    });

    const output = await executePlugToolsSocketEventNode(context, {
      credentialName: "plugDatabaseAccountApi",
      socketEventPublisher,
    });

    expect(socketEventPublisher).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        payloadFrameCompression: "none",
      }),
    );
    expect(output[0][0].json.__plug).toMatchObject({
      channel: "socket",
      deliveryStatus: "noRecipients",
    });
  });

  it("waits for a socket event through an injected listener", async () => {
    const socketEventListener = vi.fn(async (input: PlugToolsSocketEventListenInput) => ({
      event: {
        eventName: input.eventName,
        eventId: "event-99",
        publisher: "client-1",
        payload: { value: 1 },
        attachments: [],
      },
      metadata: {
        socketId: "socket-1",
        payloadFrameRequestId: "frame-1",
        subscriptionCount: 1,
      },
    }));
    const context = createToolContext({
      parameters: {
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        listenTimeoutMs: 5000,
        socketAckTimeoutMs: 2000,
        binaryPropertyPrefix: "attachment",
        includePlugMetadata: true,
      },
    });

    const output = await executePlugToolsSocketEventNode(context, {
      credentialName: "plugDatabaseAccountApi",
      socketEventListener,
    });

    expect(socketEventListener).toHaveBeenCalled();
    expect(output[0][0].json).toMatchObject({
      eventName: "client:custom.status.changed",
      eventId: "event-99",
      payload: { value: 1 },
      __plug: {
        channel: "socket",
        operation: "waitForSocketEvent",
      },
    });
  });

  it("supports the legacy publishEvent operation alias", async () => {
    const context = createToolContext({
      parameters: {
        operation: "publishEvent",
        publishChannel: "rest",
        eventName: "client:custom.legacy.event",
        payloadJson: "{}",
        attachments: {},
      },
    });

    const output = await executePlugToolsSocketEventNode(context, {
      credentialName: "plugDatabaseAccountApi",
    });

    expect(output[0][0].json.success).toBe(true);
  });

  it("rejects socket publish when the package has no socket publisher", async () => {
    const context = createToolContext({
      parameters: {
        operation: "publishSocketEvent",
        publishChannel: "socket",
        eventName: "client:custom.status.changed",
        payloadJson: "{}",
        attachments: {},
      },
    });

    await expect(
      executePlugToolsSocketEventNode(context, {
        credentialName: "plugDatabaseAccountApi",
      }),
    ).rejects.toThrow(/Publish Channel must be REST/i);
  });

  it("rejects payloads larger than the socket event JSON limit", async () => {
    const oversizedPayload = JSON.stringify({
      blob: "x".repeat(defaultCustomSocketEventPayloadJsonMaxBytes),
    });
    const context = createToolContext({
      parameters: {
        operation: "publishSocketEvent",
        publishChannel: "rest",
        eventName: "client:custom.status.changed",
        payloadJson: oversizedPayload,
        attachments: {},
      },
    });

    await expect(
      executePlugToolsSocketEventNode(context, {
        credentialName: "plugDatabaseAccountApi",
      }),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });

  it("requires a payload signing key when signature enforcement is enabled", async () => {
    const context = createToolContext({
      parameters: {
        operation: "waitForSocketEvent",
        eventName: "client:custom.status.changed",
        requirePayloadSignature: true,
      },
      credentials: {
        payloadSigningKey: "",
      },
    });

    await expect(
      executePlugToolsSocketEventNode(context, {
        credentialName: "plugDatabaseAccountApi",
        socketEventListener: vi.fn(),
      }),
    ).rejects.toBeInstanceOf(NodeOperationError);
  });
});
