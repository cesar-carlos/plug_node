import { describe, expect, it, vi } from "vitest";

import type {
  PlugHttpRequester,
  PlugSession,
  PlugUserAuthCredentials,
  PlugUserLoginResponse,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import type { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  approveAccessRequest,
  listAgentCatalog,
  listAgentClients,
  listManagedAccessRequests,
  rejectAccessRequest,
  revokeAgentClientAccess,
} from "../../packages/n8n-nodes-plug-database/generated/shared/rest/userAccess";

const credentials: PlugUserAuthCredentials = {
  user: "owner@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse> = {
  credentials,
  accessToken: "access-1",
  refreshToken: "refresh-1",
  loginResponse: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    user: {
      id: "user-1",
      email: "owner@example.com",
      role: "user",
    },
  },
};

describe("user access REST helpers", () => {
  it("builds query params for listAgentCatalog", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        agents: [],
        count: 0,
        total: 0,
        page: 2,
        pageSize: 10,
      },
    });

    await listAgentCatalog(requester, session, {
      status: "active",
      search: "alpha",
      page: 2,
      pageSize: 10,
    });

    expect(requester).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining(
          "/agents/catalog?status=active&search=alpha&page=2&pageSize=10",
        ),
      }),
    );
  });

  it("normalizes array responses for managed access requests", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: [
        {
          id: "request-1",
          clientId: "client-1",
          agentId: "agent-1",
          status: "pending",
          retryCount: 0,
          requestedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    const result = await listManagedAccessRequests(requester, session);

    expect(result).toMatchObject({
      total: 1,
      page: 1,
      pageSize: 1,
    });
    expect(result.items[0]).toMatchObject({
      id: "request-1",
      status: "pending",
    });
  });

  it("normalizes object responses for agent clients", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        clients: [
          {
            clientId: "client-1",
            email: "client@example.com",
            name: "Plug",
            status: "active",
          },
        ],
      },
    });

    const result = await listAgentClients(requester, session, "agent-1");

    expect(result.items[0]).toMatchObject({
      clientId: "client-1",
      email: "client@example.com",
    });
  });

  it("preserves raw mutation payloads for approve/reject/revoke", async () => {
    const requester: PlugHttpRequester = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          ok: true,
          status: "approved",
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          ok: true,
          status: "rejected",
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          ok: true,
        },
      });

    const approved = await approveAccessRequest(requester, session, "request-1");
    const rejected = await rejectAccessRequest(requester, session, "request-2");
    const revoked = await revokeAgentClientAccess(
      requester,
      session,
      "agent-1",
      "client-1",
    );

    expect(approved).toMatchObject({
      resourceType: "accessRequest",
      resourceId: "request-1",
      raw: {
        ok: true,
        status: "approved",
      },
    });
    expect(rejected).toMatchObject({
      resourceId: "request-2",
    });
    expect(revoked).toMatchObject({
      resourceType: "agentClientAccess",
      resourceId: "client-1",
      agentId: "agent-1",
    });
  });

  it("surfaces forbidden errors from user-scoped endpoints", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 403,
      headers: {},
      body: {
        message: "Forbidden",
        code: "FORBIDDEN",
      },
    });

    await expect(listManagedAccessRequests(requester, session)).rejects.toMatchObject<
      Partial<PlugError>
    >({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });
});
