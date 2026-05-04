import { describe, expect, it } from "vitest";

import type { PlugUserAuthCredentials } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { executePlugUserAccessNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugUserAccessExecution";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

const credentials: PlugUserAuthCredentials = {
  user: "owner@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
};

describe("executePlugUserAccessNode", () => {
  it("returns one item per catalog agent", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
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

    const result = await executePlugUserAccessNode(context, {
      credentialName: "plugDatabaseUserApi",
    });

    expect(result[0][0].json).toMatchObject({
      agentId: "agent-1",
      __plug: {
        operation: "listAgentCatalog",
        kind: "list",
      },
    });
  });

  it("collects every catalog page when Return All is enabled", async () => {
    const context = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "listAgentCatalog",
        includePlugMetadata: false,
        returnAll: true,
        status: "all",
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
                profileVersion: 5,
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
            count: 1,
            total: 2,
            page: 2,
            pageSize: 1,
          },
        },
      ],
    });

    const result = await executePlugUserAccessNode(context, {
      credentialName: "plugDatabaseUserApi",
    });

    expect(result[0]).toHaveLength(2);
  });

  it("returns summary envelopes for approve/reject/revoke", async () => {
    const approveContext = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "approveAccessRequest",
        includePlugMetadata: false,
        requestId: "request-1",
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
            ok: true,
          },
        },
      ],
    });

    const revokeContext = createMockExecuteContext({
      credentials,
      parameters: {
        operation: "revokeAgentClientAccess",
        includePlugMetadata: false,
        agentId: "agent-1",
        clientId: "client-1",
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
            ok: true,
          },
        },
      ],
    });

    const approveResult = await executePlugUserAccessNode(approveContext, {
      credentialName: "plugDatabaseUserApi",
    });
    const revokeResult = await executePlugUserAccessNode(revokeContext, {
      credentialName: "plugDatabaseUserApi",
    });

    expect(approveResult[0][0].json).toMatchObject({
      success: true,
      operation: "approveAccessRequest",
      resourceType: "accessRequest",
      resourceId: "request-1",
    });
    expect(revokeResult[0][0].json).toMatchObject({
      success: true,
      operation: "revokeAgentClientAccess",
      resourceType: "agentClientAccess",
      resourceId: "client-1",
    });
  });

  it("returns structured continueOnFail errors", async () => {
    const context = createMockExecuteContext({
      credentials,
      continueOnFail: true,
      parameters: {
        operation: "listManagedAccessRequests",
        includePlugMetadata: true,
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
          statusCode: 403,
          headers: {},
          body: {
            message: "Forbidden",
            code: "FORBIDDEN",
          },
        },
        {
          statusCode: 200,
          headers: {},
          body: {
            accessToken: "access-2",
            refreshToken: "refresh-2",
            user: {
              id: "user-1",
              email: "owner@example.com",
              role: "user",
            },
          },
        },
        {
          statusCode: 403,
          headers: {},
          body: {
            message: "Forbidden",
            code: "FORBIDDEN",
          },
        },
      ],
    });

    const result = await executePlugUserAccessNode(context, {
      credentialName: "plugDatabaseUserApi",
    });

    expect(result[0][0].json.error).toMatchObject({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });
});
