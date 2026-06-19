import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  assertBulkInsertWithinHubLimits,
  isLikelyReadOnlySql,
  plugBulkInsertMaxRows,
  resolveAutoMaxParallelReadOnlyBatchItems,
  shouldAutoPreferDbStreaming,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugSqlPerformanceHints";

describe("plugSqlPerformanceHints", () => {
  it("detects read-only SELECT statements conservatively", () => {
    expect(isLikelyReadOnlySql("SELECT * FROM Cliente")).toBe(true);
    expect(isLikelyReadOnlySql("  select top 10 codCliente from Cliente  ")).toBe(true);
    expect(isLikelyReadOnlySql("DELETE FROM Cliente WHERE CodCliente = 1")).toBe(false);
    expect(isLikelyReadOnlySql("SELECT 1; SELECT 2")).toBe(false);
    expect(isLikelyReadOnlySql("INSERT INTO Cliente (CodCliente) VALUES (1)")).toBe(
      false,
    );
  });

  it("suggests db streaming for large TOP or unbounded SELECT with FROM", () => {
    expect(shouldAutoPreferDbStreaming("SELECT TOP 1000 * FROM Cliente")).toBe(true);
    expect(shouldAutoPreferDbStreaming("SELECT TOP 10 * FROM Cliente")).toBe(false);
    expect(shouldAutoPreferDbStreaming("SELECT * FROM Cliente")).toBe(true);
    expect(shouldAutoPreferDbStreaming("SELECT * FROM Cliente WHERE 1=0")).toBe(false);
    expect(shouldAutoPreferDbStreaming("SELECT 1")).toBe(false);
    expect(
      shouldAutoPreferDbStreaming("UPDATE Cliente SET Nome = 'x' WHERE CodCliente = 1"),
    ).toBe(false);
  });

  it("resolves batch parallelism only for all-read-only commands when hints are enabled", () => {
    const readOnlyCommands = [
      { sql: "SELECT TOP 1 * FROM Cliente" },
      { sql: "SELECT TOP 1 * FROM Vendedor" },
      { sql: "SELECT TOP 1 * FROM Produto" },
    ];

    expect(
      resolveAutoMaxParallelReadOnlyBatchItems(readOnlyCommands, undefined, true),
    ).toBe(3);
    expect(
      resolveAutoMaxParallelReadOnlyBatchItems(readOnlyCommands, undefined, false),
    ).toBeUndefined();
    expect(resolveAutoMaxParallelReadOnlyBatchItems(readOnlyCommands, 2, true)).toBe(2);
    expect(
      resolveAutoMaxParallelReadOnlyBatchItems(
        [
          ...readOnlyCommands,
          { sql: "UPDATE Cliente SET Nome = 'x' WHERE CodCliente = 1" },
        ],
        undefined,
        true,
      ),
    ).toBeUndefined();
  });

  it("rejects bulk insert payloads above hub row limits", () => {
    const columns = [{ name: "id", type: "i64" }];
    const rows = Array.from({ length: plugBulkInsertMaxRows + 1 }, (_, index) => [index]);

    expect(() => assertBulkInsertWithinHubLimits("dbo.Example", columns, rows)).toThrow(
      PlugValidationError,
    );
    expect(() => assertBulkInsertWithinHubLimits("dbo.Example", columns, rows)).toThrow(
      /split into batches/i,
    );
  });

  it("estimates bulk insert byte limits without serializing every row", () => {
    const columns = [{ name: "payload", type: "string" }];
    const rows = Array.from({ length: 200 }, () => ["x".repeat(60_000)]);

    expect(() => assertBulkInsertWithinHubLimits("dbo.Example", columns, rows)).toThrow(
      PlugValidationError,
    );
    expect(() => assertBulkInsertWithinHubLimits("dbo.Example", columns, rows)).toThrow(
      /exceeds the hub limit/i,
    );
  });
});
