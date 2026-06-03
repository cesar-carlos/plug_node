import { describe, expect, it } from "vitest";

import { PlugDatabase as PublicPlugDatabase } from "../../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import type { PlugE2EConfig } from "./e2eEnv";
import { executeOrSkipInfrastructure } from "./executeOrSkip";
import { createLiveExecuteContext } from "./liveExecuteContext";
import {
  baseParameters,
  channelLabel,
  credentialsForChannel,
  maybeSkipInfrastructureResponse,
  type SqlLiveChannel,
} from "./sqlE2eChannel";
import {
  maybeSkipMethodNotFound,
  maybeSkipUnsuccessfulHubOption,
} from "./sqlE2eAssertions";

const resolvePaginationQuery = (hubOptionsSqlQuery: string): string => {
  if (/\border\s+by\b/i.test(hubOptionsSqlQuery)) {
    return hubOptionsSqlQuery;
  }

  return "SELECT TOP 100 * FROM Cliente ORDER BY CodCliente";
};

export const registerPlugSqlHubOptionsLiveE2E = (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
): void => {
  const label = channelLabel(channel);
  const hubSmokeQuery = e2eConfig.sqlQueries[0] ?? "SELECT TOP 10 * FROM Cliente";
  const paginationQuery = resolvePaginationQuery(e2eConfig.hubOptionsSqlQuery);

  describe.sequential(`Plug Database ${label} hub SQL options E2E`, () => {
    if (channel === "rest") {
      it(`executes sql.execute with execution_mode preserve over ${label}`, async ({
        skip,
      }) => {
        const node = new PublicPlugDatabase();
        const context = createLiveExecuteContext({
          credentials: credentialsForChannel(e2eConfig, channel),
          requestTimeoutMs: e2eConfig.timeoutMs,
          parameters: baseParameters(channel, {
            operation: "executeSql",
            inputMode: "guided",
            responseMode: "aggregatedJson",
            sql: hubSmokeQuery,
            sqlOptions: {
              timeoutMs: e2eConfig.timeoutMs,
              executionMode: "preserve",
            },
          }),
        });

        const result = await executeOrSkipInfrastructure(node, context, skip);
        maybeSkipInfrastructureResponse(
          (result[0][0].json as Record<string, unknown>).response,
          skip,
        );
        expect(result[0].length).toBeGreaterThanOrEqual(1);
      });

      it(`executes sql.execute with pagination over ${label}`, async ({ skip }) => {
        const node = new PublicPlugDatabase();
        const context = createLiveExecuteContext({
          credentials: credentialsForChannel(e2eConfig, channel),
          requestTimeoutMs: e2eConfig.timeoutMs,
          parameters: baseParameters(channel, {
            operation: "executeSql",
            inputMode: "guided",
            responseMode: "rawJsonRpc",
            sql: paginationQuery,
            sqlOptions: {
              timeoutMs: e2eConfig.timeoutMs,
              page: 1,
              pageSize: 5,
            },
          }),
        });

        const result = await executeOrSkipInfrastructure(node, context, skip);
        const output = result[0][0].json as Record<string, unknown>;
        maybeSkipInfrastructureResponse(output.response, skip);
        maybeSkipMethodNotFound(output.response, skip);
        maybeSkipUnsuccessfulHubOption(output.response, "sql.execute pagination", skip);

        const response = output.response as {
          type?: string;
          item?: { success?: boolean };
        };
        expect(response.type).toBe("single");
        expect(response.item?.success).toBe(true);
      });
    }

    if (channel === "socket") {
      it("executes smoke SQL with prefer_db_streaming over SOCKET", async ({ skip }) => {
        const node = new PublicPlugDatabase();
        const context = createLiveExecuteContext({
          credentials: credentialsForChannel(e2eConfig, channel),
          requestTimeoutMs: e2eConfig.timeoutMs,
          parameters: baseParameters(channel, {
            operation: "executeSql",
            inputMode: "guided",
            responseMode: "aggregatedJson",
            sql: hubSmokeQuery,
            sqlOptions: {
              timeoutMs: e2eConfig.timeoutMs,
              preferDbStreaming: true,
            },
          }),
        });

        const result = await executeOrSkipInfrastructure(node, context, skip);
        expect(result[0].length).toBeGreaterThanOrEqual(1);
      });
    }
  });
};
