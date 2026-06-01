import { describe, expect, it } from "vitest";

import {
  decodeAccessTokenExpMs,
  shouldRefreshAccessTokenProactively,
} from "../../packages/n8n-nodes-plug-database/generated/shared/auth/sessionRefresh";
import type { PlugSession } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { createTestAccessToken } from "./helpers/testJwt";

const credentials = {
  user: "client@example.com",
  password: "secret",
  agentId: "agent-1",
  clientToken: "client-token",
  baseUrl: "https://plug-server.example.com/api/v1",
};

const buildSession = (accessToken: string): PlugSession =>
  ({
    credentials,
    accessToken,
    refreshToken: "refresh-1",
    loginResponse: {
      accessToken,
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
  }) as PlugSession;

describe("decodeAccessTokenExpMs", () => {
  it("returns exp in milliseconds for a valid JWT payload", () => {
    const expSeconds = 1_700_000_000;
    const token = createTestAccessToken({ exp: expSeconds });

    expect(decodeAccessTokenExpMs(token)).toBe(expSeconds * 1000);
  });

  it("returns undefined for malformed tokens", () => {
    expect(decodeAccessTokenExpMs("not-a-jwt")).toBeUndefined();
    expect(decodeAccessTokenExpMs("a.b")).toBeUndefined();
    expect(decodeAccessTokenExpMs(createTestAccessToken({ sub: "client-1" }))).toBeUndefined();
  });
});

describe("shouldRefreshAccessTokenProactively", () => {
  it("returns true when access token expires inside the buffer window", () => {
    const nowMs = 1_700_000_000_000;
    const token = createTestAccessToken({
      exp: Math.floor((nowMs + 30_000) / 1000),
    });

    expect(
      shouldRefreshAccessTokenProactively(buildSession(token), 60_000, nowMs),
    ).toBe(true);
  });

  it("returns false when access token expires outside the buffer window", () => {
    const nowMs = 1_700_000_000_000;
    const token = createTestAccessToken({
      exp: Math.floor((nowMs + 120_000) / 1000),
    });

    expect(
      shouldRefreshAccessTokenProactively(buildSession(token), 60_000, nowMs),
    ).toBe(false);
  });
});
