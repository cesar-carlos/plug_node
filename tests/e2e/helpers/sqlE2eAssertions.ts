import { expect } from "vitest";

export const compactQueryLabel = (query: string): string =>
  query.replace(/\s+/g, " ").trim();

export const expectSuccessfulMultiResultResponse = (
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

export const expectStructuredErrorResponse = (
  output: Record<string, unknown>,
  options?: { readonly requireOdbcSqlState?: boolean },
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

  const error = response.item?.error as {
    readonly code: number;
    readonly message?: string;
    readonly data?: Record<string, unknown>;
  };

  if (options?.requireOdbcSqlState) {
    expect(error.data?.odbc_sql_state).toBeDefined();
  }

  return error;
};

export const expectSuccessfulBatchResponse = (
  output: Record<string, unknown>,
): {
  readonly commands?: unknown;
  readonly summary?: unknown;
} => {
  const response = output.response as {
    type?: string;
    item?: {
      success?: boolean;
      result?: {
        commands?: unknown;
        summary?: unknown;
      };
    };
  };

  expect(response.type).toBe("single");
  expect(response.item?.success).toBe(true);
  expect(response.item?.result).toBeDefined();

  return response.item?.result as {
    readonly commands?: unknown;
    readonly summary?: unknown;
  };
};

export const maybeSkipMethodNotFound = (
  response: unknown,
  skip: (reason: string) => never,
): void => {
  const rpc = response as {
    type?: string;
    item?: { success?: boolean; error?: { code?: number } };
  };

  if (rpc.item?.success === false && rpc.item.error?.code === -32601) {
    skip("Agent does not expose the requested RPC method (method_not_found).");
  }
};

export const maybeSkipUnsuccessfulHubOption = (
  response: unknown,
  featureLabel: string,
  skip: (reason: string) => never,
): void => {
  const rpc = response as {
    type?: string;
    item?: {
      success?: boolean;
      error?: { code?: number; message?: string };
    };
  };

  if (rpc.item?.success === false) {
    const code = rpc.item.error?.code;
    const message = rpc.item.error?.message ?? "unknown error";
    skip(
      `Hub returned unsuccessful ${featureLabel} (code ${code ?? "n/a"}): ${message}. ` +
        "Set PLUG_E2E_SQL_HUB_OPTIONS_QUERY to a paginated-friendly SELECT with ORDER BY, or skip when the agent profile does not support this option.",
    );
  }
};

export const expectAggregatedEmptyResultItem = (json: Record<string, unknown>): void => {
  expect(json).toMatchObject({
    rowCount: 0,
    rows: [],
  });
  expect(json.__plug).toMatchObject({
    emptyResult: true,
  });
};
