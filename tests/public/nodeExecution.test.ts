import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { executePlugClientNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugClientExecution";
import type { PlugCredentials } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

const credentials: PlugCredentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const credentialsWithoutDefaults: PlugCredentials = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const loadFixture = <T>(name: string): T =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/plug/${name}`, import.meta.url), "utf8"),
  ) as T;

describe("executePlugClientNode", () => {
  it("routes the consolidated node to client access operations", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        resource: "clientAccess",
        operation: "listClientAgents",
        includePlugMetadata: true,
        status: "active",
        search: "alpha",
        page: 1,
        pageSize: 50,
        refresh: false,
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
            agents: [
              {
                agentId: "agent-1",
                name: "Agent Alpha",
                status: "active",
                profileVersion: 4,
                isHubConnected: true,
                hasClientToken: true,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
            agentIds: ["agent-1"],
            count: 1,
            total: 1,
            page: 1,
            pageSize: 50,
          },
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0][0].json).toMatchObject({
      agentId: "agent-1",
      __plug: {
        operation: "listClientAgents",
        kind: "list",
      },
    });
    expect(context.httpRequestMock.mock.calls[1][0].url).toContain("/client/me/agents");
  });

  it("routes the consolidated node to user access operations", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        resource: "userAccess",
        operation: "listAgentCatalog",
        includePlugMetadata: true,
        status: "active",
        search: "alpha",
        page: 1,
        pageSize: 50,
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
            agents: [
              {
                agentId: "agent-1",
                name: "Agent Alpha",
                status: "active",
                profileVersion: 4,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
            count: 1,
            total: 1,
            page: 1,
            pageSize: 50,
          },
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(result[0][0].json).toMatchObject({
      agentId: "agent-1",
      __plug: {
        operation: "listAgentCatalog",
        kind: "list",
      },
    });
    expect(context.httpRequestMock.mock.calls[0][0].url).toContain("/auth/login");
  });

  it("rejects mixed resources in the same consolidated node execution", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        resource: ["sql", "clientAccess"],
        operation: ["validateContext", "listClientAgents"],
        includePlugMetadata: true,
        validateContextOptions: {
          timeoutMs: 5000,
        },
      },
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
      responses: [],
    });

    await expect(
      executePlugClientNode(context, {
        supportsSocket: false,
      }),
    ).rejects.toThrow(
      "Resource must stay the same for every item in one node execution.",
    );
  });

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

  it("prefers node overrides over credential defaults", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "validateContext",
        agentId: "agent-override",
        clientToken: "token-override",
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
            agentId: "agent-override",
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
          },
        },
      ],
    });

    await executePlugClientNode(context, {
      supportsSocket: false,
    });

    expect(context.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      agentId: "agent-override",
      command: {
        method: "client_token.getPolicy",
        params: {
          client_token: "token-override",
        },
      },
    });
  });

  it("supports executeSql overrides across multiple workflow items", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        responseMode: "aggregatedJson",
        includePlugMetadata: true,
        agentId: ["agent-1", "agent-2"],
        clientToken: ["token-1", "token-2"],
        sql: "SELECT 1",
        namedParamsJson: "",
        sqlOptions: {},
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
          body: {
            mode: "bridge",
            agentId: "agent-1",
            requestId: "request-1",
            response: {
              type: "single",
              success: true,
              item: {
                id: "rpc-1",
                success: true,
                result: {
                  rows: [{ id: 1 }],
                },
              },
            },
          },
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            mode: "bridge",
            agentId: "agent-2",
            requestId: "request-2",
            response: {
              type: "single",
              success: true,
              item: {
                id: "rpc-2",
                success: true,
                result: {
                  rows: [{ id: 2 }],
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
    expect(context.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      agentId: "agent-1",
      command: {
        method: "sql.execute",
        params: {
          client_token: "token-1",
        },
      },
    });
    expect(context.httpRequestMock.mock.calls[2][0].body).toMatchObject({
      agentId: "agent-2",
      command: {
        method: "sql.execute",
        params: {
          client_token: "token-2",
        },
      },
    });
  });

  it("allows discoverRpc without a resolved client token", async () => {
    const context = createMockExecuteContext({
      credentials: {
        ...credentialsWithoutDefaults,
        agentId: "agent-1",
      },
      parameters: {
        operation: "discoverRpc",
        inputMode: "guided",
        includePlugMetadata: true,
        discoverOptions: {},
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
              success: true,
              item: {
                id: "rpc-1",
                success: true,
                result: {
                  methods: ["rpc.discover"],
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

    expect(result[0][0].json).toHaveProperty("result.methods");
    expect(context.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      agentId: "agent-1",
      command: {
        method: "rpc.discover",
      },
    });
  });

  it("allows cancelSql without a resolved client token", async () => {
    const context = createMockExecuteContext({
      credentials: {
        ...credentialsWithoutDefaults,
        agentId: "agent-1",
      },
      parameters: {
        operation: "cancelSql",
        inputMode: "guided",
        includePlugMetadata: true,
        cancelExecutionId: "exec-1",
        cancelRequestId: "",
        cancelOptions: {},
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
              success: true,
              item: {
                id: "rpc-1",
                success: true,
                result: {
                  cancelled: true,
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

    expect(result[0][0].json).toHaveProperty("result.cancelled", true);
    expect(context.httpRequestMock.mock.calls[1][0].body).toMatchObject({
      agentId: "agent-1",
      command: {
        method: "sql.cancel",
      },
    });
  });

  it("fails clearly when Agent ID cannot be resolved", async () => {
    const context = createMockExecuteContext({
      credentials: credentialsWithoutDefaults,
      parameters: {
        operation: "discoverRpc",
        inputMode: "guided",
        includePlugMetadata: true,
        discoverOptions: {},
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
      ],
    });

    await expect(
      executePlugClientNode(context, {
        supportsSocket: false,
      }),
    ).rejects.toThrow(
      "Agent ID is required. Set it on the node or configure Default Agent ID in the credential.",
    );
  });

  it("fails clearly when Client Token is required but cannot be resolved", async () => {
    const context = createMockExecuteContext({
      credentials: {
        ...credentialsWithoutDefaults,
        agentId: "agent-1",
      },
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
      ],
    });

    await expect(
      executePlugClientNode(context, {
        supportsSocket: false,
      }),
    ).rejects.toThrow(
      "Client Token is required for this operation. Set it on the node or configure Default Client Token in the credential.",
    );
  });

  it("injects the resolved token and agent when using raw JSON-RPC over socket", async () => {
    let receivedInput:
      | {
          readonly agentId: string;
          readonly command: import("../../packages/n8n-nodes-plug-database/generated/shared/contracts/api").RpcSingleCommand;
        }
      | undefined;

    const socketExecutor = async (input: {
      readonly session: import("../../packages/n8n-nodes-plug-database/generated/shared/contracts/api").PlugSession<PlugCredentials>;
      readonly agentId: string;
      readonly command: import("../../packages/n8n-nodes-plug-database/generated/shared/contracts/api").RpcSingleCommand;
      readonly timeoutMs?: number;
      readonly responseMode: import("../../packages/n8n-nodes-plug-database/generated/shared/contracts/api").PlugResponseMode;
    }) => {
      receivedInput = {
        agentId: input.agentId,
        command: input.command,
      };

      return {
        channel: "socket" as const,
        socketMode: "relay" as const,
        agentId: input.agentId,
        requestId: "request-1",
        notification: false as const,
        conversationId: "conversation-1",
        accepted: {
          success: true as const,
          conversationId: "conversation-1",
          requestId: "request-1",
        },
        connectionReady: {
          id: "socket-1",
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
      };
    };

    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "getClientTokenPolicy",
        channel: "socket",
        inputMode: "advanced",
        responseMode: "rawJsonRpc",
        agentId: "agent-socket",
        clientToken: "token-socket",
        includePlugMetadata: true,
        advancedCommandJson:
          '{ "jsonrpc": "2.0", "method": "client_token.getPolicy", "params": {} }',
        profileOptions: {},
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: true,
      socketExecutor,
    });

    expect(result[0][0].json).toMatchObject({
      __plug: {
        channel: "socket",
        socketMode: "relay",
        agentId: "agent-socket",
      },
    });
    expect(receivedInput).toMatchObject({
      agentId: "agent-socket",
      command: {
        method: "client_token.getPolicy",
        params: {
          client_token: "token-socket",
        },
      },
    });
  });

  it("uses agents:command as the default socket path for version 2 nodes", async () => {
    const socketExecutor = vi.fn(async (input) => ({
      channel: "socket" as const,
      socketMode: "agentsCommand" as const,
      agentId: input.agentId,
      requestId: "request-1",
      notification: false as const,
      connectionReady: {
        id: "socket-1",
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
      rawChunkFrames: [],
    }));
    const legacySocketExecutor = vi.fn(async () => {
      throw new Error("legacy executor should not run for version 2 socket nodes");
    });

    const context = createMockExecuteContext({
      credentials,
      nodeTypeVersion: 2,
      parameters: {
        operation: "getClientTokenPolicy",
        channel: "socket",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        profileOptions: {},
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: true,
      socketExecutor,
      legacySocketExecutor,
    });

    expect(result[0][0].json).toMatchObject({
      __plug: {
        channel: "socket",
        socketMode: "agentsCommand",
      },
    });
    expect(socketExecutor).toHaveBeenCalledTimes(1);
    expect(legacySocketExecutor).not.toHaveBeenCalled();
    expect(socketExecutor.mock.calls[0][0]).toMatchObject({
      agentId: "agent-1",
      payloadFrameCompression: "default",
      command: {
        method: "client_token.getPolicy",
        params: {
          client_token: "client-token",
        },
      },
    });
  });

  it("keeps socket workflows on relay for version 1 nodes without new metadata", async () => {
    const socketExecutor = vi.fn(async () => {
      throw new Error(
        "agents:command executor should not run for version 1 socket nodes",
      );
    });
    const legacySocketExecutor = vi.fn(async (input) => ({
      channel: "socket" as const,
      socketMode: "relay" as const,
      agentId: input.agentId,
      requestId: "request-1",
      notification: false as const,
      conversationId: "conversation-1",
      accepted: {
        success: true as const,
        conversationId: "conversation-1",
        requestId: "request-1",
      },
      connectionReady: {
        id: "socket-1",
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

    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "getClientTokenPolicy",
        channel: "socket",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        profileOptions: {},
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
      ],
    });

    const result = await executePlugClientNode(context, {
      supportsSocket: true,
      socketExecutor,
      legacySocketExecutor,
    });

    expect(result[0][0].json).toMatchObject({
      __plug: {
        channel: "socket",
        socketMode: "relay",
      },
    });
    expect(socketExecutor).not.toHaveBeenCalled();
    expect(legacySocketExecutor).toHaveBeenCalledTimes(1);
  });

  it("allows executeBatch over the version 2 socket transport", async () => {
    const socketExecutor = vi.fn(async (input) => ({
      channel: "socket" as const,
      socketMode: "agentsCommand" as const,
      agentId: input.agentId,
      requestId: "request-1",
      notification: false as const,
      connectionReady: {
        id: "socket-1",
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
            summary: "ok",
          },
        },
      },
      rawResponsePayload: {
        summary: "ok",
      },
      chunkPayloads: [],
      rawChunkFrames: [],
    }));

    const context = createMockExecuteContext({
      credentials,
      nodeTypeVersion: 2,
      parameters: {
        operation: "executeBatch",
        channel: "socket",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        batchCommandsJson: '[{"sql":"SELECT 1"},{"sql":"SELECT 2"}]',
        batchOptions: {},
      },
      responses: [
        {
          statusCode: 200,
          headers: {},
          body: loadFixture("login.success.json"),
        },
      ],
    });

    await executePlugClientNode(context, {
      supportsSocket: true,
      socketExecutor,
    });

    expect(socketExecutor).toHaveBeenCalledTimes(1);
    expect(socketExecutor.mock.calls[0][0]).toMatchObject({
      payloadFrameCompression: "default",
      command: {
        method: "sql.executeBatch",
        params: {
          client_token: "client-token",
          commands: [{ sql: "SELECT 1" }, { sql: "SELECT 2" }],
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
