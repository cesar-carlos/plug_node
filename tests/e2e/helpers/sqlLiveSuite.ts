import { describe, expect, it } from "vitest";

import { PlugDatabase as PublicPlugDatabase } from "../../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import type { PlugE2EConfig } from "./e2eEnv";
import { executeOrSkipInfrastructure } from "./executeOrSkip";
import { createLiveExecuteContext } from "./liveExecuteContext";
import {
  missingDeniedResourceSkipReason,
  resolveNegativeProbeSkipReason,
  resolveUnauthorizedSuccessSkipReason,
} from "./policyProbes";
import {
  baseParameters,
  channelLabel,
  credentialsForChannel,
  maybeSkipInfrastructureResponse,
  type SqlLiveChannel,
} from "./sqlE2eChannel";
import {
  compactQueryLabel,
  expectAggregatedEmptyResultItem,
  expectStructuredErrorResponse,
  expectSuccessfulMultiResultResponse,
} from "./sqlE2eAssertions";

export const registerPlugSqlLiveE2E = (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
): void => {
  const label = channelLabel(channel);
  const credentials = () => credentialsForChannel(e2eConfig, channel);

  describe.sequential(`Plug Database ${label} E2E`, () => {
    it(`validates the configured credentials and client token via ${label}`, async ({
      skip,
    }) => {
      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentials(),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "validateContext",
          validateContextOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);

      expect(result[0]).toHaveLength(1);
      expect(result[0][0].json).toMatchObject({
        __plug: {
          channel,
          agentId: credentials().agentId,
        },
      });
      expect(result[0][0].json).toHaveProperty("result");
      if (channel === "socket") {
        expect(result[0][0].json).toHaveProperty("__plug.conversationId");
      }
    });

    for (const query of e2eConfig.sqlQueries) {
      it(`executes smoke SQL over ${label} (aggregated): ${compactQueryLabel(query)}`, async ({
        skip,
      }) => {
        const node = new PublicPlugDatabase();
        const context = createLiveExecuteContext({
          credentials: credentials(),
          requestTimeoutMs: e2eConfig.timeoutMs,
          parameters: baseParameters(channel, {
            operation: "executeSql",
            inputMode: "guided",
            responseMode: "aggregatedJson",
            sql: query,
            sqlOptions: {
              timeoutMs: e2eConfig.timeoutMs,
            },
          }),
        });

        const result = await executeOrSkipInfrastructure(node, context, skip);
        expect(result[0].length).toBeGreaterThanOrEqual(1);
        expect(result[0][0].json).toMatchObject({
          __plug: {
            channel,
            agentId: credentials().agentId,
          },
        });
      });
    }

    it(`returns one aggregated item for empty SQL results over ${label}`, async ({
      skip,
    }) => {
      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentials(),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "executeSql",
          inputMode: "guided",
          responseMode: "aggregatedJson",
          sql: e2eConfig.emptySqlQuery,
          sqlOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        }),
      });

      let result: Awaited<ReturnType<typeof executeOrSkipInfrastructure>>;
      try {
        result = await executeOrSkipInfrastructure(node, context, skip);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.includes("syntax error")) {
          skip(
            `Empty-result probe failed SQL validation. Set PLUG_E2E_SQL_QUERY_EMPTY (for example: SELECT * FROM Cliente WHERE 1=0). Current query: ${e2eConfig.emptySqlQuery}`,
          );
        }

        throw error;
      }

      expect(result[0]).toHaveLength(1);
      expectAggregatedEmptyResultItem(result[0][0].json as Record<string, unknown>);
    });

    it(`executes multi_result SQL over ${label} with two successful SELECT statements: ${compactQueryLabel(
      e2eConfig.multiResultSuccessSqlQuery,
    )}`, async ({ skip }) => {
      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentials(),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "executeSql",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          sql: e2eConfig.multiResultSuccessSqlQuery,
          sqlOptions: {
            timeoutMs: e2eConfig.timeoutMs,
            multiResult: true,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      maybeSkipInfrastructureResponse(output.response, skip);

      const multiResult = expectSuccessfulMultiResultResponse(output);

      expect(output).toMatchObject({
        __plug: {
          channel,
          agentId: credentials().agentId,
        },
      });
      expect(multiResult).toMatchObject({
        multi_result: true,
        result_set_count: 2,
        item_count: 2,
      });
    });

    it(`fails the whole multi_result SQL over ${label} when one statement is denied: ${compactQueryLabel(
      e2eConfig.multiResultMixedSqlQuery,
    )}`, async ({ skip }) => {
      const negativeSkip = resolveNegativeProbeSkipReason(e2eConfig);
      if (negativeSkip) {
        skip(negativeSkip);
      }

      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentials(),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "executeSql",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          sql: e2eConfig.multiResultMixedSqlQuery,
          sqlOptions: {
            timeoutMs: e2eConfig.timeoutMs,
            multiResult: true,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      maybeSkipInfrastructureResponse(output.response, skip);

      const allowedSkip = resolveUnauthorizedSuccessSkipReason(
        output.response,
        e2eConfig.deniedResource as string,
      );
      if (allowedSkip) {
        skip(allowedSkip);
      }

      const error = expectStructuredErrorResponse(output);

      expect(error).toMatchObject({
        code: -32002,
        message: "Not authorized",
      });
      expect(error.data).toMatchObject({
        reason: "unauthorized",
        category: "auth",
        retryable: false,
      });
    });

    it(`returns a structured authorization error over ${label}: ${compactQueryLabel(
      e2eConfig.unauthorizedSqlQuery,
    )}`, async ({ skip }) => {
      if (!e2eConfig.deniedResource) {
        skip(missingDeniedResourceSkipReason);
      }

      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentials(),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "executeSql",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          sql: e2eConfig.unauthorizedSqlQuery,
          sqlOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      maybeSkipInfrastructureResponse(output.response, skip);

      const allowedSkip = resolveUnauthorizedSuccessSkipReason(
        output.response,
        e2eConfig.deniedResource as string,
      );
      if (allowedSkip) {
        skip(allowedSkip);
      }

      const error = expectStructuredErrorResponse(output);

      expect(error).toMatchObject({
        code: -32002,
        message: "Not authorized",
      });
      expect(error.data).toMatchObject({
        reason: "unauthorized",
        category: "auth",
      });
    });

    it(`returns a structured SQL validation error over ${label}: ${compactQueryLabel(
      e2eConfig.invalidSqlQuery,
    )}`, async ({ skip }) => {
      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentials(),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "executeSql",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          sql: e2eConfig.invalidSqlQuery,
          sqlOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      maybeSkipInfrastructureResponse(output.response, skip);

      const error = expectStructuredErrorResponse(output);

      expect(error).toMatchObject({
        code: -32101,
        message: "SQL validation failed",
      });
      expect(error.data).toMatchObject({
        reason: "sql_validation_failed",
        category: "sql",
        retryable: false,
      });
    });

    if (e2eConfig.bulkInsertParamsJson) {
      it(`executes bulk insert SQL over ${label} when PLUG_E2E_BULK_INSERT_JSON is set`, async ({
        skip,
      }) => {
        const node = new PublicPlugDatabase();
        const params = JSON.parse(e2eConfig.bulkInsertParamsJson) as Record<
          string,
          unknown
        >;
        const context = createLiveExecuteContext({
          credentials: credentials(),
          requestTimeoutMs: e2eConfig.timeoutMs,
          parameters: baseParameters(channel, {
            operation: "bulkInsertSql",
            inputMode: "guided",
            responseMode: "rawJsonRpc",
            bulkInsertTable: String(params.table ?? ""),
            bulkInsertColumnsJson: JSON.stringify(params.columns ?? []),
            bulkInsertRowsJson: JSON.stringify(params.rows ?? []),
            bulkInsertOptions: {
              timeoutMs: e2eConfig.timeoutMs,
            },
          }),
        });

        const result = await executeOrSkipInfrastructure(node, context, skip);
        const output = result[0][0].json as Record<string, unknown>;
        const response = output.response as {
          type?: string;
          item?: { success?: boolean; error?: { code?: number } };
        };
        maybeSkipInfrastructureResponse(response, skip);

        if (response.item?.success === false && response.item.error?.code === -32601) {
          skip("Agent does not expose sql.bulkInsert (method_not_found).");
        }

        expect(response.type).toBe("single");
        expect(response.item?.success).toBe(true);
      });
    }
  });
};
