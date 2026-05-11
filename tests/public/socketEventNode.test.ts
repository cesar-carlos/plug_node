import { describe, expect, it, vi } from "vitest";
import type { IExecuteFunctions, IHttpRequestOptions } from "n8n-workflow";

import { PlugDatabaseAdvancedSocketEvent } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node";

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
    getCredentials: vi.fn(async () => credentials),
    getNodeParameter: vi.fn((name: string) => {
      const parameters: Record<string, unknown> = {
        eventName: "client:custom.status.changed",
        payloadJson: '{"status":"ready"}',
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
        timeoutMs: 15000,
        includePlugMetadata: true,
      };
      return parameters[name];
    }),
    continueOnFail: () => options?.continueOnFail ?? false,
    helpers: {
      httpRequest,
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
      __plug: {
        channel: "rest",
        operation: "publishCustomSocketEvent",
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
});
