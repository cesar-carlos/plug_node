import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type {
  BuiltCommandRequest,
  PlugCredentials,
  PlugHttpRequester,
  PlugSession,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { loginClient } from "../../packages/n8n-nodes-plug-database/generated/shared/auth/session";
import { executeRestCommand } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/client";

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

describe("Plug contract fixtures", () => {
  it("accepts the documented login fixture", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: loadFixture("login.success.json"),
    });

    const session = await loginClient(requester, credentials);

    expect(session.accessToken).toBe("access-1");
    expect(session.loginResponse.client.email).toBe(credentials.user);
  });

  it("accepts the documented REST bridge fixture for client token policy", async () => {
    const session: PlugSession = {
      credentials,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      loginResponse: loadFixture("login.success.json"),
    };

    const request: BuiltCommandRequest = {
      operation: "getClientTokenPolicy",
      channel: "rest",
      responseMode: "aggregatedJson",
      command: {
        jsonrpc: "2.0",
        method: "client_token.getPolicy",
        params: {
          client_token: credentials.clientToken,
        },
      },
    };

    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: loadFixture("client-token-policy.success.json"),
    });

    const result = await executeRestCommand(requester, session, request);

    expect(result.channel).toBe("rest");
    expect(result.requestId).toBe("request-1");
    expect(result.notification).toBe(false);
  });
});
