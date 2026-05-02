import { describe, expect, it } from "vitest";

import { PlugDatabase as PublicPlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import { getPlugE2EConfig } from "./helpers/e2eEnv";
import { getInfrastructureSkipReason } from "./helpers/environmentSkips";
import { executeOrSkipInfrastructure } from "./helpers/executeOrSkip";
import { createLiveExecuteContext } from "./helpers/liveExecuteContext";

const e2eConfig = getPlugE2EConfig();

const compactQueryLabel = (query: string): string => query.replace(/\s+/g, " ").trim();

const expectSuccessfulMultiResultResponse = (
  output: Record<string, unknown>,
): {
  readonly multi_result?: boolean;
  readonly result_set_count?: number;
  readonly item_count?: number;
  readonly result_sets?: Array<{
    readonly index?: number;
    readonly row_count?: number;
    readonly column_metadata?: Array<{
      readonly name?: string;
    }>;
  }>;
  readonly items?: Array<{
    readonly type?: string;
    readonly index?: number;
    readonly result_set_index?: number;
    readonly row_count?: number;
    readonly affected_rows?: number;
  }>;
} => {
  const response = output.response as {
    type?: string;
    item?: {
      success?: boolean;
      result?: {
        multi_result?: boolean;
        result_set_count?: number;
        item_count?: number;
        result_sets?: Array<{
          index?: number;
          row_count?: number;
          column_metadata?: Array<{
            name?: string;
          }>;
        }>;
        items?: Array<{
          type?: string;
          index?: number;
          result_set_index?: number;
          row_count?: number;
          affected_rows?: number;
        }>;
      };
    };
  };

  expect(response.type).toBe("single");
  expect(response.item?.success).toBe(true);
  expect(response.item?.result).toBeDefined();

  return response.item?.result as {
    readonly multi_result?: boolean;
    readonly result_set_count?: number;
    readonly item_count?: number;
    readonly result_sets?: Array<{
      readonly index?: number;
      readonly row_count?: number;
      readonly column_metadata?: Array<{
        readonly name?: string;
      }>;
    }>;
    readonly items?: Array<{
      readonly type?: string;
      readonly index?: number;
      readonly result_set_index?: number;
      readonly row_count?: number;
      readonly affected_rows?: number;
    }>;
  };
};

const expectStructuredErrorResponse = (
  output: Record<string, unknown>,
): {
  readonly code: number;
  readonly message?: string;
  readonly data?: Record<string, unknown>;
} => {
  const response = output.response as {
    type?: string;
    item?: {
      success?: boolean;
      error?: {
        code?: number;
        message?: string;
        data?: Record<string, unknown>;
      };
    };
  };

  expect(response.type).toBe("single");
  expect(response.item?.success).toBe(false);
  expect(response.item?.error).toBeDefined();

  return response.item?.error as {
    readonly code: number;
    readonly message?: string;
    readonly data?: Record<string, unknown>;
  };
};

describe.sequential("Plug Database REST E2E", () => {
  it("validates the configured credentials and client token via REST", async ({
    skip,
  }) => {
    const node = new PublicPlugDatabase();
    const context = createLiveExecuteContext({
      credentials: e2eConfig.credentials,
      parameters: {
        operation: "validateContext",
        includePlugMetadata: true,
        validateContextOptions: {
          timeoutMs: e2eConfig.timeoutMs,
        },
      },
    });

    const result = await executeOrSkipInfrastructure(node, context, skip);

    expect(result[0]).toHaveLength(1);
    expect(result[0][0].json).toMatchObject({
      __plug: {
        channel: "rest",
        agentId: e2eConfig.credentials.agentId,
      },
    });
    expect(result[0][0].json).toHaveProperty("result");
  });

  for (const query of e2eConfig.sqlQueries) {
    it(`executes smoke SQL over REST: ${compactQueryLabel(query)}`, async ({ skip }) => {
      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: e2eConfig.credentials,
        parameters: {
          operation: "executeSql",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          includePlugMetadata: true,
          sql: query,
          sqlOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        },
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      const response = output.response as {
        type?: string;
        item?: {
          success?: boolean;
        };
      };
      const skipReason = getInfrastructureSkipReason(response);
      if (skipReason) {
        skip(skipReason);
      }

      expect(result[0]).toHaveLength(1);
      expect(output).toMatchObject({
        __plug: {
          channel: "rest",
          agentId: e2eConfig.credentials.agentId,
        },
      });
      expect(response.type).toBe("single");
      expect(response.item?.success).toBe(true);
    });
  }

  it(`executes multi_result SQL over REST with two successful SELECT statements: ${compactQueryLabel(
    e2eConfig.multiResultSuccessSqlQuery,
  )}`, async ({ skip }) => {
    const node = new PublicPlugDatabase();
    const context = createLiveExecuteContext({
      credentials: e2eConfig.credentials,
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        sql: e2eConfig.multiResultSuccessSqlQuery,
        sqlOptions: {
          timeoutMs: e2eConfig.timeoutMs,
          multiResult: true,
        },
      },
    });

    const result = await executeOrSkipInfrastructure(node, context, skip);
    const output = result[0][0].json as Record<string, unknown>;
    const response = output.response as {
      type?: string;
      item?: {
        success?: boolean;
      };
    };
    const skipReason = getInfrastructureSkipReason(response);
    if (skipReason) {
      skip(skipReason);
    }

    const multiResult = expectSuccessfulMultiResultResponse(output);

    expect(output).toMatchObject({
      __plug: {
        channel: "rest",
        agentId: e2eConfig.credentials.agentId,
      },
    });
    expect(multiResult).toMatchObject({
      multi_result: true,
      result_set_count: 2,
      item_count: 2,
    });
    expect(multiResult.result_sets).toHaveLength(2);
    expect(multiResult.items).toHaveLength(2);
    expect(multiResult.result_sets?.[0]?.index).toBe(0);
    expect(multiResult.result_sets?.[1]?.index).toBe(1);
    expect(multiResult.result_sets?.[0]?.row_count).toBeGreaterThanOrEqual(0);
    expect(multiResult.result_sets?.[1]?.row_count).toBeGreaterThanOrEqual(0);
    expect(multiResult.result_sets?.[0]?.column_metadata?.length ?? 0).toBeGreaterThan(0);
    expect(multiResult.result_sets?.[1]?.column_metadata?.length ?? 0).toBeGreaterThan(0);
    expect(multiResult.items?.[0]).toMatchObject({
      type: "result_set",
      index: 0,
      result_set_index: 0,
    });
    expect(multiResult.items?.[1]).toMatchObject({
      type: "result_set",
      index: 1,
      result_set_index: 1,
    });
  });

  it(`fails the whole multi_result SQL over REST when one statement is denied: ${compactQueryLabel(
    e2eConfig.multiResultMixedSqlQuery,
  )}`, async ({ skip }) => {
    const node = new PublicPlugDatabase();
    const context = createLiveExecuteContext({
      credentials: e2eConfig.credentials,
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        sql: e2eConfig.multiResultMixedSqlQuery,
        sqlOptions: {
          timeoutMs: e2eConfig.timeoutMs,
          multiResult: true,
        },
      },
    });

    const result = await executeOrSkipInfrastructure(node, context, skip);
    const output = result[0][0].json as Record<string, unknown>;
    const response = output.response as {
      item?: {
        result?: unknown;
      };
    };
    const skipReason = getInfrastructureSkipReason(output.response);
    if (skipReason) {
      skip(skipReason);
    }

    const error = expectStructuredErrorResponse(output);

    expect(output).toMatchObject({
      __plug: {
        channel: "rest",
        agentId: e2eConfig.credentials.agentId,
      },
    });
    expect(response.item?.result).toBeUndefined();
    expect(error).toMatchObject({
      code: -32002,
      message: "Not authorized",
    });
    expect(error.data).toMatchObject({
      reason: "unauthorized",
      category: "auth",
      retryable: false,
    });
    expect(error.data?.user_message).toEqual(expect.stringContaining("empresa"));
    expect(error.data?.denied_resources).toEqual(expect.arrayContaining(["empresa"]));
    expect(error.data?.correlation_id).toEqual(expect.any(String));
  });

  it(`returns a structured authorization error over REST: ${compactQueryLabel(
    e2eConfig.unauthorizedSqlQuery,
  )}`, async ({ skip }) => {
    const node = new PublicPlugDatabase();
    const context = createLiveExecuteContext({
      credentials: e2eConfig.credentials,
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        sql: e2eConfig.unauthorizedSqlQuery,
        sqlOptions: {
          timeoutMs: e2eConfig.timeoutMs,
        },
      },
    });

    const result = await executeOrSkipInfrastructure(node, context, skip);
    const output = result[0][0].json as Record<string, unknown>;
    const skipReason = getInfrastructureSkipReason(output.response);
    if (skipReason) {
      skip(skipReason);
    }

    const error = expectStructuredErrorResponse(output);

    expect(output).toMatchObject({
      __plug: {
        channel: "rest",
        agentId: e2eConfig.credentials.agentId,
      },
    });
    expect(error).toMatchObject({
      code: -32002,
      message: "Not authorized",
    });
    expect(error.data).toMatchObject({
      reason: "unauthorized",
      category: "auth",
    });
    expect(error.data?.user_message).toEqual(expect.stringContaining("empresa"));
    expect(error.data?.denied_resources).toEqual(expect.arrayContaining(["empresa"]));
    expect(error.data?.correlation_id).toEqual(expect.any(String));
  });

  it(`returns a structured SQL validation error over REST: ${compactQueryLabel(
    e2eConfig.invalidSqlQuery,
  )}`, async ({ skip }) => {
    const node = new PublicPlugDatabase();
    const context = createLiveExecuteContext({
      credentials: e2eConfig.credentials,
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        responseMode: "rawJsonRpc",
        includePlugMetadata: true,
        sql: e2eConfig.invalidSqlQuery,
        sqlOptions: {
          timeoutMs: e2eConfig.timeoutMs,
        },
      },
    });

    const result = await executeOrSkipInfrastructure(node, context, skip);
    const output = result[0][0].json as Record<string, unknown>;
    const skipReason = getInfrastructureSkipReason(output.response);
    if (skipReason) {
      skip(skipReason);
    }

    const error = expectStructuredErrorResponse(output);

    expect(output).toMatchObject({
      __plug: {
        channel: "rest",
        agentId: e2eConfig.credentials.agentId,
      },
    });
    expect(error).toMatchObject({
      code: -32101,
      message: "SQL validation failed",
    });
    expect(error.data).toMatchObject({
      reason: "sql_validation_failed",
      category: "sql",
      retryable: false,
    });
    expect(error.data?.user_message).toEqual(expect.any(String));
    expect(error.data?.technical_message).toEqual(expect.any(String));
    expect(error.data?.correlation_id).toEqual(expect.any(String));
    expect(error.data?.odbc_sql_state).toBeDefined();
  });
});
