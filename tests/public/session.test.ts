import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import type {
  PlugCredentials,
  PlugHttpRequester,
} from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";
import {
  PlugError,
  PlugValidationError,
} from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/errors";
import {
  createExecutionSessionRunner,
  createHttpError,
  loginClient,
  refreshClientSession,
  withAutoRefreshSession,
} from "../../packages/n8n-nodes-plug-client/generated/shared/auth/session";

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

describe("auth session runner", () => {
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
      .mockImplementationOnce(async (session) => session.accessToken);

    const result = await withAutoRefreshSession(requester, credentials, callback);

    expect(result).toBe("access-2");
    expect(callback).toHaveBeenCalledTimes(2);
    expect(requester).toHaveBeenCalledTimes(2);
  });

  it("reuses the same authenticated session across sequential callbacks", async () => {
    const loginSuccess = loadFixture("login.success.json");
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: loginSuccess,
    });

    const runner = createExecutionSessionRunner(requester, credentials);
    const first = await runner(async (session) => session.accessToken);
    const second = await runner(async (session) => session.accessToken);

    expect(first).toBe("access-1");
    expect(second).toBe("access-1");
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent login attempts into a single HTTP login", async () => {
    const loginSuccess = loadFixture("login.success.json");
    const requester: PlugHttpRequester = vi.fn(
      async () =>
        await new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              statusCode: 200,
              headers: {},
              body: loginSuccess,
            });
          }, 10);
        }),
    );

    const runner = createExecutionSessionRunner(requester, credentials);
    const [first, second] = await Promise.all([
      runner(async (session) => session.accessToken),
      runner(async (session) => session.accessToken),
    ]);

    expect(first).toBe("access-1");
    expect(second).toBe("access-1");
    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("does not refresh when the callback fails with a non-auth error", async () => {
    const loginSuccess = loadFixture("login.success.json");
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: loginSuccess,
    });
    const runner = createExecutionSessionRunner(requester, credentials);

    await expect(
      runner(async () => {
        throw new PlugError("Query failed", {
          code: "SQL_FAILED",
          statusCode: 500,
          authRelated: false,
        });
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      message: "Query failed",
      code: "SQL_FAILED",
    });

    expect(requester).toHaveBeenCalledTimes(1);
  });

  it("surfaces the refresh failure when the refresh token is rejected", async () => {
    const loginSuccess = loadFixture("login.success.json");
    const requester: PlugHttpRequester = vi
      .fn()
      .mockResolvedValueOnce({
        statusCode: 200,
        headers: {},
        body: loginSuccess,
      })
      .mockResolvedValueOnce({
        statusCode: 401,
        headers: {},
        body: {
          message: "Refresh token expired",
          code: "REFRESH_EXPIRED",
        },
      });
    const runner = createExecutionSessionRunner(requester, credentials);

    await expect(
      runner(async () => {
        throw new PlugError("Expired token", {
          code: "TOKEN_EXPIRED",
          statusCode: 401,
          authRelated: true,
        });
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      message: "The Plug session expired and could not be refreshed.",
      code: "REFRESH_EXPIRED",
      statusCode: 401,
      authRelated: true,
    });

    expect(requester).toHaveBeenCalledTimes(2);
  });
});

describe("loginClient", () => {
  it("returns a normalized session from a successful login response", async () => {
    const loginSuccess = loadFixture("login.success.json");
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: loginSuccess,
    });

    const session = await loginClient(requester, credentials);

    expect(session).toMatchObject({
      credentials,
      accessToken: "access-1",
      refreshToken: "refresh-1",
    });
  });

  it("rejects malformed login responses that do not contain accessToken", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: {
        refreshToken: "refresh-1",
        client: { id: "client-1" },
      },
    });

    await expect(loginClient(requester, credentials)).rejects.toBeInstanceOf(
      PlugValidationError,
    );
  });

  it("returns a clearer invalid-credentials error for login 401 responses", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 401,
      headers: {},
      body: {
        message: "Invalid credentials",
        code: "INVALID_CREDENTIALS",
      },
    });

    await expect(loginClient(requester, credentials)).rejects.toMatchObject<
      Partial<PlugError>
    >({
      message: "Plug rejected the login credentials.",
      code: "INVALID_CREDENTIALS",
      statusCode: 401,
      authRelated: true,
      description: "Check User (email) and Password in the credential.",
      technicalMessage: "Invalid credentials",
    });
  });

  it("returns a clearer blocked-account error for login 403 responses", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 403,
      headers: {},
      body: {
        message: "Account blocked by administrator",
        code: "ACCOUNT_BLOCKED",
      },
    });

    await expect(loginClient(requester, credentials)).rejects.toMatchObject<
      Partial<PlugError>
    >({
      message: "The Plug account is blocked.",
      code: "ACCOUNT_BLOCKED",
      statusCode: 403,
      authRelated: true,
      description: "Contact the account owner or administrator to unblock the account.",
      technicalMessage: "Account blocked by administrator",
    });
  });
});

describe("refreshClientSession", () => {
  it("returns a new normalized session from a successful refresh response", async () => {
    const refreshSuccess = loadFixture("refresh.success.json");
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 200,
      headers: {},
      body: refreshSuccess,
    });
    const initialSession = {
      credentials,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      loginResponse: loadFixture("login.success.json"),
    };

    const refreshed = await refreshClientSession(requester, initialSession);

    expect(refreshed).toMatchObject({
      credentials,
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    expect(refreshed.loginResponse.client).toMatchObject({
      id: "client-1",
      email: "client@example.com",
      role: "client",
    });
  });

  it("returns a clearer auth-expired error when refresh is rejected", async () => {
    const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
      statusCode: 401,
      headers: {},
      body: {
        message: "Refresh token expired",
        code: "REFRESH_EXPIRED",
      },
    });
    const initialSession = {
      credentials,
      accessToken: "access-1",
      refreshToken: "refresh-1",
      loginResponse: loadFixture("login.success.json"),
    };

    await expect(refreshClientSession(requester, initialSession)).rejects.toMatchObject<
      Partial<PlugError>
    >({
      message: "The Plug session expired and could not be refreshed.",
      code: "REFRESH_EXPIRED",
      statusCode: 401,
      authRelated: true,
      description: "Run the node again to create a new authenticated session.",
      technicalMessage: "Refresh token expired",
    });
  });
});

describe("createHttpError", () => {
  it("turns validation issues into a clearer user-facing description", () => {
    const error = createHttpError(
      400,
      {
        message: "Validation failed",
        code: "BAD_REQUEST",
        issues: [
          {
            field: "command.params.sql",
            message: "Required",
          },
          {
            field: "command.params.client_token",
            message: "Must be a string",
          },
        ],
      },
      {},
    );

    expect(error).toMatchObject<Partial<PlugError>>({
      message: "Plug rejected the request parameters.",
      code: "BAD_REQUEST",
      description:
        "command.params.sql: Required; command.params.client_token: Must be a string",
      technicalMessage: "Validation failed",
    });
  });

  it("extracts retry timing from response details when Retry-After is missing", () => {
    const error = createHttpError(
      503,
      {
        message: "Agent queue is full",
        code: "AGENT_OVERLOADED",
        details: {
          retry_after_ms: 1200,
        },
      },
      {},
    );

    expect(error).toMatchObject<Partial<PlugError>>({
      message: "Agent queue is full",
      code: "AGENT_OVERLOADED",
      retryAfterSeconds: 2,
      technicalMessage: "Agent queue is full",
    });
    expect(error.description).toContain("Wait 2 second(s) before trying again.");
  });

  it("extracts Retry-After header values for HTTP 429 rate limits", () => {
    const error = createHttpError(
      429,
      {
        message: "Rate limit exceeded",
        code: "RATE_LIMITED",
      },
      {
        "retry-after": "7",
      },
    );

    expect(error).toMatchObject<Partial<PlugError>>({
      message: "Plug rate limited this request.",
      code: "RATE_LIMITED",
      retryAfterSeconds: 7,
      retryable: true,
      technicalMessage: "Rate limit exceeded",
    });
    expect(error.description).toContain("Wait 7 second(s) before trying again.");
  });
});
