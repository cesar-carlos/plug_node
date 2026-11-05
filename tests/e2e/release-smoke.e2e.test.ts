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

  it.each(["rest", "socket", "relay"] as const)(
    "should read one bounded Action I/O catalog page over %s",
    async (channel) => {
      const credentials = credentialsForChannel(
        config,
        channel === "rest" ? "rest" : "socket",
      );
      const actionAgent = process.env.PLUG_E2E_ACTION_AGENT_ID?.trim();
      const actionToken =
        actionAgent ||
        channel === "rest" ||
        credentials.agentId === config.credentials.agentId
          ? process.env.PLUG_E2E_ACTION_CLIENT_TOKEN?.trim()
          : undefined;
      const socketToken =
        channel === "rest"
          ? undefined
          : process.env.PLUG_E2E_SOCKET_ACTION_CLIENT_TOKEN?.trim();
      if (actionAgent && !socketToken && !actionToken) {
        throw new Error(
          `Missing PLUG_E2E_ACTION_CLIENT_TOKEN for the dedicated staging Action I/O agent (${channel}).`,
        );
      }
      const context = createLiveExecuteContext({
        credentials: {
          ...credentials,
          user: process.env.PLUG_E2E_ACTION_USER?.trim() || credentials.user,
          password: process.env.PLUG_E2E_ACTION_PASSWORD || credentials.password,
          agentId: actionAgent || credentials.agentId,
          clientToken: socketToken || actionToken || credentials.clientToken,
        },
        requestTimeoutMs: config.timeoutMs,
        inputData: [{ json: {} }],
        parameters: {
          resource: "actionIo",
          operation: "listAvailable",
          actionChannel: channel,
          catalogPageSize: 1,
        },
      });
      const [items] = await new PlugDatabase().execute.call(context);
      expect(items).toHaveLength(1);
      const { actions, next_cursor } = items[0].json;
      expect(Array.isArray(actions)).toBe(true);
      expect((actions as unknown[]).length).toBeLessThanOrEqual(1);
      expect(next_cursor === null || typeof next_cursor === "string").toBe(true);
    },
  );

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
