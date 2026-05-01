import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type {
  PlugCredentials,
  PlugHttpRequester,
} from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";
import { PlugError } from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/errors";
import { withAutoRefreshSession } from "../../packages/n8n-nodes-plug-client/generated/shared/auth/session";

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

describe("withAutoRefreshSession", () => {
  it("refreshes the session once when an auth-related error happens", async () => {
    const loginSuccess = loadFixture("login.success.json");
    const refreshSuccess = loadFixture("refresh.success.json");

    const requester: PlugHttpRequester = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: loginSuccess,
      })
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: refreshSuccess,
      });

    const callback = vi
      .fn()
      .mockRejectedValueOnce(
        new PlugError("Expired token", {
          code: "TOKEN_EXPIRED",
          statusCode: 401,
          authRelated: true,
        }),
      )
      .mockImplementationOnce(async (session) => {
        return session.accessToken;
      });

    const result = await withAutoRefreshSession(requester, credentials, callback);

    expect(result).toBe("access-2");
    expect(callback).toHaveBeenCalledTimes(2);
    expect(requester).toHaveBeenCalledTimes(2);
  });
});
