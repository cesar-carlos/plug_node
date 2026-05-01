import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { executePlugClientNode } from "../../packages/n8n-nodes-plug-client/generated/shared/n8n/plugClientExecution";
import type { PlugCredentials } from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

const credentials: PlugCredentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const loadFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/plug/${name}`, import.meta.url), "utf8"),
  ) as T;

describe("executePlugClientNode", () => {
  it("reuses a single login across multiple items in the same execution", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: true,
        validateContextOptions: {
          timeoutMs: 5000,
        },
      },
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
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
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("client-token-policy.success.json"),
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0]).toHaveLength(2);
    expect(context.httpRequestMock).toHaveBeenCalledTimes(3);
    expect(context.httpRequestMock.mock.calls[0][0].url).toContain("/client-auth/login");
    expect(context.httpRequestMock.mock.calls[1][0].url).toContain("/agents/commands");
    expect(context.httpRequestMock.mock.calls[2][0].url).toContain("/agents/commands");
  });

  it("validates context end to end and injects the credential client token", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: true,
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
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0][0].json).toMatchObject({
      __plug: {
        channel: "rest",
        agentId: "agent-1",
        requestId: "request-1",
      },
      result: {
        policy: "approved",
        client_token: "token-present",
      },
    });

    expect(context.httpRequestMock).toHaveBeenCalledTimes(2);
    expect(context.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      agentId: "agent-1",
      command: {
        method: "client_token.getPolicy",
        params: {
          client_token: credentials.clientToken,
        },
      },
    });
  });

  it("supports raw JSON-RPC output without __plug metadata", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "getClientTokenPolicy",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: false,
        profileOptions: {},
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
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0][0].json).not.toHaveProperty("__plug");
    expect(result[0][0].json).toHaveProperty("response");
  });

  it("retries retryable idempotent operations once without re-running login", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: true,
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
          statusCode: 429,
          headers: {
            "retry-after": "0",
          },
          body: {
            message: "Rate limit reached",
            code: "RATE_LIMITED",
          },
        },
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("client-token-policy.success.json"),
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0][0].json).toHaveProperty("result.policy", "approved");
    expect(context.httpRequestMock).toHaveBeenCalledTimes(3);
    expect(context.httpRequestMock.mock.calls[0][0].url).toContain("/client-auth/login");
    expect(context.httpRequestMock.mock.calls[1][0].url).toContain("/agents/commands");
    expect(context.httpRequestMock.mock.calls[2][0].url).toContain("/agents/commands");
  });

  it("returns clearer structured error data when continueOnFail is enabled", async () => {
    const context = createMockExecuteContext({
      credentials,
      continueOnFail: true,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: true,
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
          body: {
            mode: "bridge",
            agentId: "agent-1",
            requestId: "request-1",
            response: {
              type: "single",
              success: false,
              item: {
                id: "rpc-1",
                success: false,
                error: {
                  code: -32000,
                  message: "agent_offline",
                  data: {
                    reason: "agent_disconnected_at_dispatch",
                    category: "transport",
                    retryable: false,
                    correlation_id: "corr-1",
                  },
                },
              },
            },
          },
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0][0].json.error).toMatchObject({
      message: "The agent is offline right now.",
      description: "Reconnect the Plug agent and run the node again.",
      code: "RPC_-32000",
      correlationId: "corr-1",
      technicalMessage: "agent_offline",
      details: {
        reason: "agent_disconnected_at_dispatch",
      },
    });
  });

  it("preserves successful items alongside continueOnFail errors in the same execution", async () => {
    const context = createMockExecuteContext({
      credentials,
      continueOnFail: true,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: true,
        validateContextOptions: {
          timeoutMs: 5000,
        },
      },
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
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
        {
          statusCode: 200,
          headers: {},
          body: {
            mode: "bridge",
            agentId: "agent-1",
            requestId: "request-2",
            response: {
              type: "single",
              success: false,
              item: {
                id: "rpc-2",
                success: false,
                error: {
                  code: -32002,
                  message: "Not authorized",
                  data: {
                    reason: "unauthorized",
                    category: "auth",
                    retryable: false,
                    correlation_id: "corr-2",
                    user_message: "Access denied to empresa.",
                    denied_resources: ["empresa"],
                  },
                },
              },
            },
          },
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0]).toHaveLength(2);
    expect(result[0][0].json).toMatchObject({
      result: {
        policy: "approved",
      },
      __plug: {
        requestId: "request-1",
      },
    });
    expect(result[0][1].json.error).toMatchObject({
      message: "Access denied to empresa.",
      code: "RPC_-32002",
      correlationId: "corr-2",
      details: {
        denied_resources: ["empresa"],
        reason: "unauthorized",
      },
    });
    expect(context.httpRequestMock).toHaveBeenCalledTimes(3);
  });
});
