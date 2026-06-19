import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  assertAdvancedJsonRpcMethod,
  parseAdvancedJsonRpcCommand,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugAdvancedJsonRpcValidation";

describe("plugAdvancedJsonRpcValidation", () => {
  it("accepts a minimal sql.execute command", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "sql.execute",
      params: {
        sql: "SELECT 1",
      },
    });

    expect(command.method).toBe("sql.execute");
    expect(command.params).toEqual({ sql: "SELECT 1" });
  });

  it("rejects sql.execute with cursor combined with page", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.execute",
        params: {
          sql: "SELECT 1",
          options: { cursor: "cursor-1", page: 1, page_size: 10 },
        },
      }),
    ).toThrow(/cursor/i);
  });

  it("rejects sql.execute with multi_result and named params together", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.execute",
        params: {
          sql: "SELECT 1",
          params: { id: 1 },
          options: { multi_result: true },
        },
      }),
    ).toThrow(/multi_result/i);
  });

  it("rejects sql.execute with preserve execution mode and pagination", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.execute",
        params: {
          sql: "SELECT 1",
          options: { execution_mode: "preserve", page: 1, page_size: 10 },
        },
      }),
    ).toThrow(/preserve/i);
  });

  it("rejects sql.execute without sql", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.execute",
        params: {},
      }),
    ).toThrow(/params\.sql/i);
  });

  it("rejects sql.execute with page without page_size", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.execute",
        params: {
          sql: "SELECT 1",
          options: { page: 1 },
        },
      }),
    ).toThrow(/page_size/i);
  });

  it("accepts sql.executeBatch with commands", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "sql.executeBatch",
      params: {
        commands: [{ sql: "SELECT 1" }],
      },
    });

    expect(command.method).toBe("sql.executeBatch");
  });

  it("rejects sql.executeBatch with empty commands", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.executeBatch",
        params: { commands: [] },
      }),
    ).toThrow(/commands/i);
  });

  it("accepts sql.bulkInsert with matching row width", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "sql.bulkInsert",
      params: {
        table: "dbo.Items",
        columns: [{ name: "id", type: "int" }],
        rows: [[1]],
      },
    });

    expect(command.method).toBe("sql.bulkInsert");
  });

  it("rejects sql.bulkInsert when row width mismatches columns", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.bulkInsert",
        params: {
          table: "dbo.Items",
          columns: [
            { name: "id", type: "int" },
            { name: "name", type: "nvarchar" },
          ],
          rows: [[1]],
        },
      }),
    ).toThrow(/row at index 0/i);
  });

  it("accepts sql.cancel with execution_id", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "sql.cancel",
      params: { execution_id: "exec-1" },
    });

    expect(command.method).toBe("sql.cancel");
  });

  it("rejects sql.cancel without execution_id or request_id", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.cancel",
        params: {},
      }),
    ).toThrow(/execution_id/i);
  });

  it("accepts rpc.discover without params", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "rpc.discover",
    });

    expect(command.method).toBe("rpc.discover");
  });

  it("accepts agent.getProfile without params", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "agent.getProfile",
    });

    expect(command.method).toBe("agent.getProfile");
  });

  it("rejects unknown top-level keys", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.execute",
        params: { sql: "SELECT 1" },
        extra: true,
      }),
    ).toThrow(PlugValidationError);
  });

  it("rejects unsupported methods", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "sql.dropDatabase",
        params: {},
      }),
    ).toThrow(/method/i);
  });

  it("rejects non-object params", () => {
    expect(() =>
      parseAdvancedJsonRpcCommand({
        method: "rpc.discover",
        params: "invalid",
      }),
    ).toThrow(PlugValidationError);
  });

  it("asserts the selected operation method", () => {
    const command = parseAdvancedJsonRpcCommand({
      method: "sql.execute",
      params: { sql: "SELECT 1" },
    });

    expect(() => assertAdvancedJsonRpcMethod(command, "sql.cancel")).toThrow(
      /method must be sql.cancel/i,
    );
  });
});
