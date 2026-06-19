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
  approveOwnedClientRegistration,
  getOwnedClient,
  listAgentCatalog,
  listAgentClients,
  listManagedAccessRequests,
  listOwnedClients,
  rejectAccessRequest,
  rejectOwnedClientRegistration,
  revokeAgentClientAccess,
  setOwnedClientStatus,
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

  it("builds query params for listManagedAccessRequests", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        items: [],
        total: 0,
        page: 2,
        pageSize: 25,
      },
    });

    await listManagedAccessRequests(requester, session, {
      page: 2,
      pageSize: 25,
    });

    expect(requester).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining("/me/client-access-requests?page=2&pageSize=25"),
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

  it("builds query params for /me/clients list and detail", async () => {
    const listRequester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        clients: [
          {
            id: "client-1",
            email: "client@example.com",
            status: "active",
          },
        ],
        count: 1,
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });

    await listOwnedClients(listRequester, session, {
      status: "active",
      search: "plug",
      page: 2,
      pageSize: 25,
    });

    expect(listRequester).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining(
          "/me/clients?status=active&search=plug&page=2&pageSize=25",
        ),
      }),
    );

    const detailRequester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        client: {
          id: "client-1",
          email: "client@example.com",
          status: "active",
        },
      },
    });

    const detail = await getOwnedClient(detailRequester, session, "client-1");

    expect(detail.client).toMatchObject({
      id: "client-1",
      email: "client@example.com",
    });
  });

  it("builds owned client governance mutations", async () => {
    const requester: PlugHttpRequester = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          client: {
            id: "client-1",
            status: "blocked",
          },
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          approved: true,
          clientEmail: "client@example.com",
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          rejected: true,
          clientEmail: "pending@example.com",
        },
      });

    const status = await setOwnedClientStatus(requester, session, {
      clientId: "client-1",
      status: "blocked",
    });
    const approved = await approveOwnedClientRegistration(requester, session, "client-1");
    const rejected = await rejectOwnedClientRegistration(requester, session, {
      clientId: "client-2",
      reason: "incomplete profile",
    });

    expect(status.client).toMatchObject({ id: "client-1", status: "blocked" });
    expect(approved).toMatchObject({
      resourceType: "ownedClientGovernance",
      resourceId: "client-1",
      raw: { approved: true },
    });
    expect(rejected).toMatchObject({
      resourceId: "client-2",
      raw: { rejected: true },
    });

    expect(requester).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        method: "PATCH",
        url: expect.stringContaining("/me/clients/client-1/status"),
        body: { status: "blocked" },
      }),
    );
    expect(requester).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        method: "POST",
        url: expect.stringContaining("/me/clients/client-2/registration/reject"),
        body: { reason: "incomplete profile" },
      }),
    );
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
