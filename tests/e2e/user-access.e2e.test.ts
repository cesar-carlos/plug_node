import { describe, expect, it } from "vitest";

import { loginUser } from "../../packages/n8n-nodes-plug-database/generated/shared/auth/session";
import { listOwnedClients } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/userAccess";
import { getInfrastructureSkipReason } from "./helpers/environmentSkips";
import { createLiveRequester } from "./helpers/liveRequester";

const getOptionalOwnerCredentials = ():
  | {
      readonly user: string;
      readonly password: string;
      readonly baseUrl: string;
    }
  | undefined => {
  const user = process.env.PLUG_E2E_OWNER_USER?.trim();
  const password = process.env.PLUG_E2E_OWNER_PASSWORD?.trim();
  const baseUrl = process.env.PLUG_E2E_BASE_URL?.trim();

  if (!user || !password) {
    return undefined;
  }

  return {
    user,
    password,
    baseUrl:
      baseUrl && baseUrl !== ""
        ? baseUrl
        : "https://plug-server.se7esistemassinop.com.br/api/v1",
  };
};

describe.sequential("Plug user access /me/clients E2E", () => {
  it("lists owned clients for a real owner account when owner credentials are configured", async ({
    skip,
  }) => {
    const ownerCredentials = getOptionalOwnerCredentials();
    if (!ownerCredentials) {
      skip(
        "Set PLUG_E2E_OWNER_USER and PLUG_E2E_OWNER_PASSWORD to run owner governance E2E.",
      );
    }

    try {
      const requester = createLiveRequester();
      const session = await loginUser(requester, ownerCredentials);
      const response = await listOwnedClients(requester, session, {
        page: 1,
        pageSize: 10,
      });

      expect(Array.isArray(response.clients)).toBe(true);
      expect(response.page).toBe(1);
      expect(response.pageSize).toBe(10);
      expect(response.count).toBeGreaterThanOrEqual(0);
    } catch (error: unknown) {
      const skipReason = getInfrastructureSkipReason(error);
      if (skipReason) {
        skip(skipReason);
      }
      throw error;
    }
  });
});
