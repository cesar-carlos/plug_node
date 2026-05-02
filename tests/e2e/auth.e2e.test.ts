import { describe, expect, it, vi } from "vitest";

import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  createExecutionSessionRunner,
  loginClient,
  refreshClientSession,
} from "../../packages/n8n-nodes-plug-database/generated/shared/auth/session";
import { getPlugE2EConfig } from "./helpers/e2eEnv";
import { getInfrastructureSkipReason } from "./helpers/environmentSkips";
import { createLiveRequester } from "./helpers/liveRequester";

const e2eConfig = getPlugE2EConfig();

describe.sequential("Plug Database auth E2E", () => {
  it("logs in with the real client credentials", async ({ skip }) => {
    try {
      const session = await loginClient(
        createLiveRequester(e2eConfig.credentials),
        e2eConfig.credentials,
      );

      expect(session.accessToken).toEqual(expect.any(String));
      expect(session.refreshToken).toEqual(expect.any(String));
      expect(session.loginResponse.client.email.toLowerCase()).toBe(
        e2eConfig.credentials.user.toLowerCase(),
      );
      expect(session.loginResponse.client.role).toBe("client");
    } catch (error: unknown) {
      const skipReason = getInfrastructureSkipReason(error);
      if (skipReason) {
        skip(skipReason);
      }
      throw error;
    }
  });

  it("refreshes the real client session with the refresh token returned by login", async ({
    skip,
  }) => {
    try {
      const requester = createLiveRequester(e2eConfig.credentials);
      const session = await loginClient(requester, e2eConfig.credentials);
      const refreshed = await refreshClientSession(requester, session);

      expect(refreshed.accessToken).toEqual(expect.any(String));
      expect(refreshed.refreshToken).toEqual(expect.any(String));
      expect(refreshed.loginResponse.client.id).toBe(session.loginResponse.client.id);
      expect(refreshed.loginResponse.client.email.toLowerCase()).toBe(
        e2eConfig.credentials.user.toLowerCase(),
      );
    } catch (error: unknown) {
      const skipReason = getInfrastructureSkipReason(error);
      if (skipReason) {
        skip(skipReason);
      }
      throw error;
    }
  });

  it("returns a structured auth error when the refresh token is invalid", async ({
    skip,
  }) => {
    try {
      const requester = createLiveRequester(e2eConfig.credentials);
      const session = await loginClient(requester, e2eConfig.credentials);

      await expect(
        refreshClientSession(requester, {
          ...session,
          refreshToken: `${session.refreshToken}-invalid`,
        }),
      ).rejects.toMatchObject({
        message: "The Plug session expired and could not be refreshed.",
        statusCode: 401,
        authRelated: true,
      });
    } catch (error: unknown) {
      const skipReason = getInfrastructureSkipReason(error);
      if (skipReason) {
        skip(skipReason);
      }
      throw error;
    }
  });

  it("performs a real refresh when the session runner receives an auth-expiry error", async ({
    skip,
  }) => {
    const baseRequester = createLiveRequester(e2eConfig.credentials);
    const requester = vi.fn(baseRequester);
    const runner = createExecutionSessionRunner(requester, e2eConfig.credentials);
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

    try {
      const accessToken = await runner(callback);

      expect(accessToken).toEqual(expect.any(String));
      expect(callback).toHaveBeenCalledTimes(2);
      expect(requester).toHaveBeenCalledTimes(2);
    } catch (error: unknown) {
      const skipReason = getInfrastructureSkipReason(error);
      if (skipReason) {
        skip(skipReason);
      }
      throw error;
    }
  });
});
