import { describe, expect, it } from "vitest";

import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import {
  loginClient,
  refreshClientSession,
} from "../../packages/n8n-nodes-plug-database/generated/shared/auth/session";
import { getPlugE2EConfig } from "./helpers/e2eEnv";
import { createLiveRequester } from "./helpers/liveRequester";
import { createLiveExecuteContext } from "./helpers/liveExecuteContext";
import { credentialsForChannel } from "./helpers/sqlE2eChannel";

// Release evidence is fail-closed: no infrastructure skips and no data mutations.
const config = getPlugE2EConfig();
if (!process.env.PLUG_E2E_BASE_URL?.trim()) {
  throw new Error(
    "Release smoke requires an explicit PLUG_E2E_BASE_URL for the target environment.",
  );
}
describe("release staging smoke", () => {
  it("should authenticate and refresh a real session", async () => {
    const requester = createLiveRequester();
    const session = await loginClient(requester, config.credentials);
    const refreshed = await refreshClientSession(requester, session);
    expect(refreshed.accessToken).toEqual(expect.any(String));
    expect(refreshed.loginResponse.client.id).toBe(session.loginResponse.client.id);
  });

  it.each(["rest", "socket"] as const)(
    "should execute a read-only query over %s",
    async (channel) => {
      const context = createLiveExecuteContext({
        credentials: credentialsForChannel(config, channel),
        requestTimeoutMs: config.timeoutMs,
        parameters: {
          resource: "sql",
          operation: "executeSql",
          channel,
          sql: "SELECT COUNT(*) AS plug_release_smoke FROM Cliente WHERE 1=0",
          inputMode: "guided",
          responseMode: "aggregatedJson",
          includePlugMetadata: false,
          sqlOptions: {
            timeoutMs: config.timeoutMs,
            maxRows: 1,
            preferDbStreaming: false,
          },
        },
      });
      const output = await new PlugDatabase().execute.call(context);
      expect(output[0]).toHaveLength(1);
      expect(output[0][0].json).toMatchObject({ plug_release_smoke: 0 });
    },
  );
});
