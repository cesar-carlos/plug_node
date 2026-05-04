import { describe, expect, it, vi } from "vitest";

import type {
  PlugClientAuthCredentials,
  PlugHttpRequester,
  PlugSession,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import type { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  getClientAgentToken,
  listClientAccessRequests,
  listClientAgents,
  requestClientAgentAccess,
  revokeClientAgentAccess,
  setClientAgentToken,
} from "../../packages/n8n-nodes-plug-database/generated/shared/rest/clientAccess";

const credentials: PlugClientAuthCredentials = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const session: PlugSession<PlugClientAuthCredentials> = {
  credentials,
  accessToken: "access-1",
  refreshToken: "refresh-1",
  loginResponse: {
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

describe("client access REST helpers", () => {
  it("builds query params for listClientAgents", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        agents: [],
        agentIds: [],
        count: 0,
        total: 0,
        page: 2,
        pageSize: 10,
      },
    });

    await listClientAgents(requester, session, {
      status: "active",
      search: "alpha",
      page: 2,
      pageSize: 10,
      refresh: true,
    });

    expect(requester).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "GET",
        url: expect.stringContaining(
          "/client/me/agents?status=active&search=alpha&page=2&pageSize=10&refresh=true",
        ),
      }),
    );
  });

  it("parses access request records", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        items: [
          {
            id: "request-1",
            clientId: "client-1",
            agentId: "agent-1",
            status: "pending",
            retryCount: 1,
            requestedAt: "2026-01-01T00:00:00.000Z",
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-01T00:00:00.000Z",
            agentName: "Agent Alpha",
          },
        ],
        total: 1,
        page: 1,
        pageSize: 50,
      },
    });

    const result = await listClientAccessRequests(requester, session, {});

    expect(result.items[0]).toMatchObject({
      agentId: "agent-1",
      status: "pending",
      agentName: "Agent Alpha",
    });
  });

  it("preserves request access response arrays", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        requested: ["agent-1"],
        alreadyApproved: ["agent-2"],
        newRequests: ["agent-1"],
        reopened: [],
        debounced: ["agent-3"],
      },
    });

    const result = await requestClientAgentAccess(requester, session, {
      agentIds: ["agent-1", "agent-2", "agent-3"],
    });

    expect(result).toMatchObject({
      requested: ["agent-1"],
      alreadyApproved: ["agent-2"],
      debounced: ["agent-3"],
    });
  });

  it("surfaces conflict errors for duplicate request access attempts", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 409,
      headers: {},
      body: {
        message: "Request already exists",
        code: "CLIENT_AGENT_ACCESS_CONFLICT",
      },
    });

    await expect(
      requestClientAgentAccess(requester, session, {
        agentIds: ["agent-1"],
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "CLIENT_AGENT_ACCESS_CONFLICT",
      statusCode: 409,
    });
  });

  it("uses the path revoke endpoint for single-agent revoke", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        ok: true,
      },
    });

    const result = await revokeClientAgentAccess(requester, session, {
      agentId: "agent-1",
    });

    expect(requester).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "https://plug-server.example.com/api/v1/client/me/agents/agent-1",
      }),
    );
    expect(result).toMatchObject({
      revokeMode: "single",
      agentId: "agent-1",
      revokedCount: 1,
    });
  });

  it("uses the JSON body revoke endpoint for batch revoke", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        ok: true,
      },
    });

    const result = await revokeClientAgentAccess(requester, session, {
      agentIds: ["agent-1", "agent-2"],
    });

    expect(requester).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "DELETE",
        url: "https://plug-server.example.com/api/v1/client/me/agents",
        body: {
          agentIds: ["agent-1", "agent-2"],
        },
      }),
    );
    expect(result).toMatchObject({
      revokeMode: "batch",
      agentIds: ["agent-1", "agent-2"],
      revokedCount: 2,
    });
  });

  it("gets and clears the per-agent client token", async () => {
    const requester: PlugHttpRequester = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          agentId: "agent-1",
          clientToken: "token-1",
        },
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: {
          agentId: "agent-1",
          clientToken: null,
        },
      });

    const getResult = await getClientAgentToken(requester, session, "agent-1");
    const setResult = await setClientAgentToken(requester, session, {
      agentId: "agent-1",
      clientToken: null,
    });

    expect(getResult).toEqual({
      agentId: "agent-1",
      clientToken: "token-1",
    });
    expect(setResult).toEqual({
      agentId: "agent-1",
      clientToken: null,
    });
  });

  it("rejects malformed token payloads that omit clientToken", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        agentId: "agent-1",
      },
    });

    await expect(getClientAgentToken(requester, session, "agent-1")).rejects.toBeInstanceOf(
      PlugValidationError,
    );
  });

  it("surfaces Plug errors for forbidden token access", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 403,
      headers: {},
      body: {
        message: "Forbidden",
        code: "FORBIDDEN",
      },
    });

    await expect(
      getClientAgentToken(requester, session, "agent-1"),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "FORBIDDEN",
      statusCode: 403,
    });
  });
});
