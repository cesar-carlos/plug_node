import { describe, expect, it } from "vitest";

import type { PlugResolvedExecutionContext } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  buildGuidedBatchCommand,
  buildGuidedBulkInsertCommand,
  buildGuidedCancelCommand,
  buildGuidedSqlCommand,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugSqlGuidedCommands";
import { finalizeBuiltCommandRequest } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugCommandRequestBuilder";
import { plugBulkInsertMaxRows } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugSqlPerformanceHints";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

const executionContext: PlugResolvedExecutionContext = {
  user: "client@example.com",
  password: "secret",
  baseUrl: "https://plug-server.example.com/api/v1",
  resolvedAgentId: "agent-1",
  resolvedClientToken: "client-token",
};

describe("plugSqlGuidedCommands", () => {
  it("builds sql.execute with execution_mode preserve", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        agentId: "agent-1",
        clientToken: "client-token",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        sql: "SELECT TOP 1 * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          executionMode: "preserve",
        },
      },
      responses: [],
    });

    const built = buildGuidedSqlCommand(context, 0, executionContext);

    expect(built.command).toMatchObject({
      method: "sql.execute",
      params: {
        client_token: "client-token",
        sql: "SELECT TOP 1 * FROM Cliente",
        options: {
          execution_mode: "preserve",
        },
      },
    });
  });

  it("builds sql.execute with page and page_size", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        sql: "SELECT * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          page: 1,
          pageSize: 10,
        },
      },
      responses: [],
    });

    const built = buildGuidedSqlCommand(context, 0, executionContext);

    expect(built.command.params?.options).toMatchObject({
      page: 1,
      page_size: 10,
    });
  });

  it("rejects preserve combined with pagination", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        sql: "SELECT * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          executionMode: "preserve",
          page: 1,
          pageSize: 10,
        },
      },
      responses: [],
    });

    expect(() => buildGuidedSqlCommand(context, 0, executionContext)).toThrow(
      PlugValidationError,
    );
  });

  it("rejects multi_result with named params", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        sql: "SELECT TOP 10 * FROM Cliente WHERE CodCliente = :codCliente",
        namedParamsJson: '{"codCliente":1}',
        sqlOptions: {
          multiResult: true,
        },
      },
      responses: [],
    });

    expect(() => buildGuidedSqlCommand(context, 0, executionContext)).toThrow(
      "Multi Result cannot be combined with Named Params JSON",
    );
  });

  it("builds sql.execute with prefer_db_streaming", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        sql: "SELECT TOP 1 * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          preferDbStreaming: true,
        },
      },
      responses: [],
    });

    const built = buildGuidedSqlCommand(context, 0, executionContext);

    expect(built.command.params?.options).toMatchObject({
      prefer_db_streaming: true,
    });
  });

  it("builds sql.executeBatch with max_parallel_read_only_batch_items", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        batchCommandsJson:
          '[{"sql":"SELECT TOP 1 * FROM Cliente"},{"sql":"SELECT TOP 1 * FROM Vendedor"}]',
        batchOptions: {
          maxParallelReadOnlyBatchItems: 2,
        },
      },
      responses: [],
    });

    const built = buildGuidedBatchCommand(context, 0, executionContext);

    expect(built.command).toMatchObject({
      method: "sql.executeBatch",
      params: {
        client_token: "client-token",
        commands: [
          { sql: "SELECT TOP 1 * FROM Cliente" },
          { sql: "SELECT TOP 1 * FROM Vendedor" },
        ],
        options: {
          max_parallel_read_only_batch_items: 2,
        },
      },
    });
  });

  it("rejects batch commands with unsafe DELETE", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        batchCommandsJson: '[{"sql":"DELETE FROM Cliente"}]',
        batchOptions: {},
      },
      responses: [],
    });

    expect(() => buildGuidedBatchCommand(context, 0, executionContext)).toThrow(
      "Batch command at index 0 contains UPDATE/DELETE without WHERE",
    );
  });

  it("builds sql.bulkInsert with table, columns, and rows", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        bulkInsertTable: "dbo.Example",
        bulkInsertColumnsJson: '[{"name":"id","type":"i64"}]',
        bulkInsertRowsJson: "[[1]]",
        bulkInsertOptions: {},
      },
      responses: [],
    });

    const built = buildGuidedBulkInsertCommand(context, 0, executionContext);

    expect(built.command).toMatchObject({
      method: "sql.bulkInsert",
      params: {
        table: "dbo.Example",
        columns: [{ name: "id", type: "i64" }],
        rows: [[1]],
        client_token: "client-token",
      },
    });
  });

  it("rejects bulk insert rows with mismatched column count", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        bulkInsertTable: "dbo.Example",
        bulkInsertColumnsJson: '[{"name":"id","type":"i64"}]',
        bulkInsertRowsJson: "[[1,2]]",
        bulkInsertOptions: {},
      },
      responses: [],
    });

    expect(() => buildGuidedBulkInsertCommand(context, 0, executionContext)).toThrow(
      "Row at index 0 must have 1 value(s) to match Columns JSON",
    );
  });

  it("applies auto max_parallel_read_only_batch_items for read-only batches when hints are enabled", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        batchCommandsJson:
          '[{"sql":"SELECT TOP 1 * FROM Cliente"},{"sql":"SELECT TOP 1 * FROM Vendedor"}]',
        batchOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
    });

    const built = buildGuidedBatchCommand(context, 0, executionContext);

    expect(built.command.params?.options).toMatchObject({
      max_parallel_read_only_batch_items: 2,
    });
  });

  it("does not apply auto batch parallelism when the batch contains mutations", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        batchCommandsJson:
          '[{"sql":"SELECT TOP 1 * FROM Cliente"},{"sql":"UPDATE Cliente SET Nome = \'x\' WHERE CodCliente = 1"}]',
        batchOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
    });

    const built = buildGuidedBatchCommand(context, 0, executionContext);

    expect(
      built.command.params?.options?.max_parallel_read_only_batch_items,
    ).toBeUndefined();
  });

  it("applies auto prefer_db_streaming on socket when hints are enabled", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        channel: "socket",
        sql: "SELECT * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          autoPerformanceHints: true,
        },
      },
      responses: [],
      nodeTypeVersion: 2,
    });

    const built = finalizeBuiltCommandRequest(
      buildGuidedSqlCommand(context, 0, executionContext),
      context,
      0,
      { supportsSocket: true },
      "executeSql",
    );

    expect(built.command.params?.options).toMatchObject({
      prefer_db_streaming: true,
    });
    expect(built.channel).toBe("socket");
  });

  it("respects explicit preferDbStreaming false even when auto hints are enabled", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        channel: "socket",
        sql: "SELECT * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          autoPerformanceHints: true,
          preferDbStreaming: false,
        },
      },
      responses: [],
      nodeTypeVersion: 2,
    });

    const built = finalizeBuiltCommandRequest(
      buildGuidedSqlCommand(context, 0, executionContext),
      context,
      0,
      { supportsSocket: true },
      "executeSql",
    );

    expect(built.command.params?.options).toMatchObject({
      prefer_db_streaming: false,
    });
  });

  it("does not apply auto prefer_db_streaming when multi_result is enabled", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        channel: "socket",
        sql: "SELECT * FROM Cliente",
        namedParamsJson: "",
        sqlOptions: {
          autoPerformanceHints: true,
          multiResult: true,
        },
      },
      responses: [],
      nodeTypeVersion: 2,
    });

    const built = finalizeBuiltCommandRequest(
      buildGuidedSqlCommand(context, 0, executionContext),
      context,
      0,
      { supportsSocket: true },
      "executeSql",
    );

    expect(built.command.params?.options?.prefer_db_streaming).toBeUndefined();
  });

  it("rejects bulk insert above hub row limits", () => {
    const rows = Array.from({ length: plugBulkInsertMaxRows + 1 }, (_, index) => [index]);
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        bulkInsertTable: "dbo.Example",
        bulkInsertColumnsJson: '[{"name":"id","type":"i64"}]',
        bulkInsertRowsJson: JSON.stringify(rows),
        bulkInsertOptions: {},
      },
      responses: [],
    });

    expect(() => buildGuidedBulkInsertCommand(context, 0, executionContext)).toThrow(
      PlugValidationError,
    );
  });

  it("builds sql.cancel with execution_id and request_id", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "client@example.com",
        password: "secret",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        cancelExecutionId: "exec-1",
        cancelRequestId: "req-1",
        cancelOptions: {},
      },
      responses: [],
    });

    const built = buildGuidedCancelCommand(context, 0, executionContext);

    expect(built.command).toMatchObject({
      method: "sql.cancel",
      params: {
        execution_id: "exec-1",
        request_id: "req-1",
      },
    });
  });
});
