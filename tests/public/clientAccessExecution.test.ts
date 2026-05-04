import { describe, expect, it } from "vitest";

import type { PlugClientAuthCredentials } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { executePlugClientAccessNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugClientAccessExecution";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

const credentials: PlugClientAuthCredentials = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
};

describe("executePlugClientAccessNode", () => {
  it("returns one item per agent for listClientAgents", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "listClientAgents",
        includePlugMetadata: true,
        status: "active",
        search: "alpha",
        page: 1,
        pageSize: 50,
        refresh: true,
      },
      responses: [
        {
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
                isHubConnected: true,
                hasClientToken: true,
              },
              {
                agentId: "agent-2",
                name: "Agent Beta",
                status: "inactive",
                profileVersion: 2,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                isHubConnected: false,
                hasClientToken: false,
              },
            ],
            agentIds: ["agent-1", "agent-2"],
            count: 2,
            total: 2,
            page: 1,
            pageSize: 50,
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0]).toHaveLength(2);
    expect(result[0][0].json).toMatchObject({
      agentId: "agent-1",
      __plug: {
        operation: "listClientAgents",
        kind: "list",
      },
    });
    expect(result[0][1].json).toMatchObject({
      agentId: "agent-2",
    });
  });

  it("collects every page when Return All is enabled", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "listClientAgents",
        includePlugMetadata: false,
        status: "all",
        search: "",
        returnAll: true,
        refresh: false,
      },
      responses: [
        {
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
                isHubConnected: true,
                hasClientToken: true,
              },
            ],
            agentIds: ["agent-1"],
            count: 1,
            total: 2,
            page: 1,
            pageSize: 1,
          },
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agents: [
              {
                agentId: "agent-2",
                name: "Agent Beta",
                status: "inactive",
                profileVersion: 2,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
                isHubConnected: false,
                hasClientToken: false,
              },
            ],
            agentIds: ["agent-2"],
            count: 1,
            total: 2,
            page: 2,
            pageSize: 1,
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0]).toHaveLength(2);
    expect(result[0][0].json).toMatchObject({ agentId: "agent-1" });
    expect(result[0][1].json).toMatchObject({ agentId: "agent-2" });
  });

  it("returns a single item for getClientAgent", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "getClientAgent",
        includePlugMetadata: false,
        agentId: "agent-1",
      },
      responses: [
        {
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
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agent: {
              agentId: "agent-1",
              name: "Agent Alpha",
              status: "active",
              profileVersion: 4,
              createdAt: "2026-01-01T00:00:00.000Z",
              updatedAt: "2026-01-02T00:00:00.000Z",
              isHubConnected: true,
              hasClientToken: true,
            },
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0]).toEqual([
      {
        json: {
          agentId: "agent-1",
          name: "Agent Alpha",
          status: "active",
          profileVersion: 4,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          isHubConnected: true,
          hasClientToken: true,
        },
      },
    ]);
  });

  it("preserves request access summary arrays", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "requestAgentAccess",
        includePlugMetadata: true,
        agentIds: {
          values: [{ agentId: "agent-1" }, { agentId: "agent-2" }],
        },
      },
      responses: [
        {
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
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            requested: ["agent-1"],
            alreadyApproved: ["agent-2"],
            newRequests: ["agent-1"],
            reopened: [],
            debounced: [],
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0][0].json).toMatchObject({
      success: true,
      requested: ["agent-1"],
      alreadyApproved: ["agent-2"],
      resourceType: "clientAgentAccessRequest",
      __plug: {
        operation: "requestAgentAccess",
        kind: "summary",
      },
    });
  });

  it("supports batch revoke summaries", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "revokeAgentAccess",
        includePlugMetadata: false,
        revokeMode: "batch",
        revokeAgentIds: {
          values: [{ agentId: "agent-1" }, { agentId: "agent-2" }],
        },
      },
      responses: [
        {
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
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            ok: true,
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0][0].json).toMatchObject({
      success: true,
      revokeMode: "batch",
      agentIds: ["agent-1", "agent-2"],
      revokedCount: 2,
    });
  });

  it("gets and clears client tokens", async () => {
    const getContext = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "getClientToken",
        includePlugMetadata: false,
        agentId: "agent-1",
      },
      responses: [
        {
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
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agentId: "agent-1",
            clientToken: null,
          },
        },
      ],
    });

    const setContext = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "setClientToken",
        includePlugMetadata: false,
        agentId: "agent-1",
        clearStoredClientToken: true,
      },
      responses: [
        {
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
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agentId: "agent-1",
            clientToken: null,
          },
        },
      ],
    });

    const getResult = await executePlugClientAccessNode(getContext, {
      credentialName: "plugDatabaseClientApi",
    });
    const setResult = await executePlugClientAccessNode(setContext, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(getResult[0][0].json).toMatchObject({
      agentId: "agent-1",
      clientToken: null,
      hasClientToken: false,
      cleared: true,
    });
    expect(setResult[0][0].json).toMatchObject({
      agentId: "agent-1",
      clientToken: null,
      cleared: true,
    });
  });

  it("refreshes once on auth failure and retries the client access operation", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "getClientToken",
        includePlugMetadata: false,
        agentId: "agent-1",
      },
      responses: [
        {
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
        },
        {
          statusCode: 401,
          headers: {},
          body: {
            message: "Expired token",
            code: "TOKEN_EXPIRED",
          },
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            accessToken: "access-2",
            refreshToken: "refresh-2",
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
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            agentId: "agent-1",
            clientToken: "token-2",
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0][0].json).toMatchObject({
      agentId: "agent-1",
      clientToken: "token-2",
      hasClientToken: true,
    });
  });

  it("returns structured continueOnFail errors", async () => {
    const context = createMockExecuteContext({
      credentials,
      continueOnFail: true,
      parameters: {
        operation: "getClientAgent",
        includePlugMetadata: true,
        agentId: "agent-1",
      },
      responses: [
        {
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
        },
        {
          statusCode: 404,
          headers: {},
          body: {
            message: "Agent not found",
            code: "AGENT_NOT_FOUND",
          },
        },
      ],
    });

    const result = await executePlugClientAccessNode(context, {
      credentialName: "plugDatabaseClientApi",
    });

    expect(result[0][0].json.error).toMatchObject({
      code: "AGENT_NOT_FOUND",
      statusCode: 404,
    });
  });
});
