import { afterEach, describe, expect, it } from "vitest";

import {
  isSqlInputItemParallelismSafe,
  plugMaxParallelInputItems,
  resolveMaxParallelInputItems,
  resolvePlugSqlInputItemParallelism,
  socketRestAgentMaxInflight,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugInputItemParallelism";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

describe("plugInputItemParallelism", () => {
  const originalEnv = process.env.PLUG_MAX_PARALLEL_INPUT_ITEMS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.PLUG_MAX_PARALLEL_INPUT_ITEMS;
    } else {
      process.env.PLUG_MAX_PARALLEL_INPUT_ITEMS = originalEnv;
    }
  });

  it("defaults to sequential execution unless parallelism is safe and enabled", () => {
    expect(resolveMaxParallelInputItems(false, 4, true, 3)).toBe(1);
    expect(resolveMaxParallelInputItems(true, undefined, false, 3)).toBe(1);
    expect(resolveMaxParallelInputItems(true, undefined, true, 3)).toBe(
      Math.min(3, plugMaxParallelInputItems, socketRestAgentMaxInflight),
    );
  });

  it("caps explicit parallelism by hub inflight and item count", () => {
    expect(resolveMaxParallelInputItems(true, 99, true, 2)).toBe(2);
    expect(resolveMaxParallelInputItems(true, 99, true, 99)).toBe(
      Math.min(plugMaxParallelInputItems, socketRestAgentMaxInflight),
    );
  });

  it("allows read-only executeSql batches of input items when hints are enabled", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        sql: "SELECT TOP 1 * FROM Cliente",
        sqlOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(true);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(2);
  });

  it("keeps mutating executeSql input items sequential", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        sql: "UPDATE Cliente SET Nome = 'x' WHERE CodCliente = 1",
        sqlOptions: {
          autoPerformanceHints: true,
          maxParallelInputItems: 4,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(false);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(1);
  });

  it("honors explicit maxParallelInputItems for safe read-only SQL", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        sql: "SELECT TOP 1 * FROM Cliente",
        sqlOptions: {
          autoPerformanceHints: false,
          maxParallelInputItems: 2,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }, { json: { row: 3 } }],
    });

    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(2);
  });

  it("reads PLUG_MAX_PARALLEL_INPUT_ITEMS as the auto-hints ceiling", () => {
    process.env.PLUG_MAX_PARALLEL_INPUT_ITEMS = "2";

    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeSql",
        inputMode: "guided",
        sql: "SELECT TOP 1 * FROM Cliente",
        sqlOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
      inputData: Array.from({ length: 4 }, (_, index) => ({ json: { row: index } })),
    });

    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(2);
  });

  it("allows advanced read-only executeSql items to run in parallel", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeSql",
        inputMode: "advanced",
        advancedCommandJson: JSON.stringify({
          method: "sql.execute",
          params: { sql: "SELECT TOP 1 CodCliente FROM Cliente" },
        }),
        sqlOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(true);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(2);
  });

  it("blocks advanced mutating executeSql items from parallel execution", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeSql",
        inputMode: "advanced",
        advancedCommandJson: JSON.stringify({
          method: "sql.execute",
          params: { sql: "UPDATE Cliente SET Nome = 'x' WHERE CodCliente = 1" },
        }),
        sqlOptions: {
          autoPerformanceHints: true,
          maxParallelInputItems: 4,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(false);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(1);
  });

  it("allows advanced read-only executeBatch items without transactions", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeBatch",
        inputMode: "advanced",
        advancedCommandJson: JSON.stringify({
          method: "sql.executeBatch",
          params: {
            commands: [
              { sql: "SELECT TOP 1 CodCliente FROM Cliente" },
              { sql: "SELECT TOP 1 CodVendedor FROM Vendedor" },
            ],
          },
        }),
        batchOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(true);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(2);
  });

  it("blocks guided executeBatch items that enable transactions", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeBatch",
        inputMode: "guided",
        batchCommandsJson: JSON.stringify([
          { sql: "SELECT TOP 1 CodCliente FROM Cliente" },
        ]),
        batchOptions: {
          transaction: true,
          autoPerformanceHints: true,
          maxParallelInputItems: 4,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(false);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(1);
  });

  it("blocks advanced executeBatch items that enable transactions", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        operation: "executeBatch",
        inputMode: "advanced",
        advancedCommandJson: JSON.stringify({
          method: "sql.executeBatch",
          params: {
            commands: [{ sql: "SELECT TOP 1 CodCliente FROM Cliente" }],
            options: { transaction: true },
          },
        }),
        batchOptions: {
          autoPerformanceHints: true,
          maxParallelInputItems: 4,
        },
      },
      responses: [],
      inputData: [{ json: { row: 1 } }, { json: { row: 2 } }],
    });

    expect(isSqlInputItemParallelismSafe(context, 2)).toBe(false);
    expect(resolvePlugSqlInputItemParallelism(context, context.getInputData())).toBe(1);
  });
});
