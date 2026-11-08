import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  assertBulkInsertWithinHubLimits,
  isLikelyReadOnlySql,
  isLikelyUnboundedSelectSql,
  plugBulkInsertMaxRows,
  plugBulkInsertMaxJsonBytes,
  resolveAutoMaxParallelReadOnlyBatchItems,
  shouldAutoPreferDbStreaming,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugSqlPerformanceHints";

describe("plugSqlPerformanceHints", () => {
  it.each([
    "SELECT 1 -- '\nINTO target FROM source -- '",
    "SELECT 1 /* ' */ INTO target /* ' */ FROM source",
    "SELECT 1 /* -- ignored */ INTO target FROM source",
  ])("does not hide SELECT INTO behind comment delimiters: %s", (sql) => {
    expect(isLikelyReadOnlySql(sql)).toBe(false);
    expect(
      resolveAutoMaxParallelReadOnlyBatchItems([{ sql }], undefined, true),
    ).toBeUndefined();
  });
  it.each([
    ["SELECT /* note */ TOP (1000) 'ação 🌱; INTO' AS label", true, false],
    ["SELECT TOP 999 x FROM t", false, false],
    ["SELECT TOP 1000 x FROM t WHERE 1 = 0", false, false],
    ["SELECT TOP 1000 x INTO t FROM s", false, false],
    ["SELECT TOP 1000 x FROM t; DELETE FROM t", false, false],
    ["SELECT '🌱' AS label -- TOP 1000\n FROM t", false, true],
  ])(
    "preserves streaming and unbounded classification for %s",
    (sql, streaming, unbounded) => {
      expect(shouldAutoPreferDbStreaming(String(sql))).toBe(streaming);
      expect(isLikelyUnboundedSelectSql(String(sql))).toBe(unbounded);
    },
  );
  it.each([
    "SELECT id INTO InventoryCopy FROM Inventory",
    "SELECT TOP 1000 id\nINTO #InventoryCopy FROM Inventory",
    "SELECT id /* comment */ INTO InventoryCopy FROM Inventory",
    "SELECT id/**/INTO/**/InventoryCopy FROM Inventory",
  ])("does not automatically parallelize SELECT INTO (%s)", (sql) => {
    expect(isLikelyReadOnlySql(sql)).toBe(false);
    expect(shouldAutoPreferDbStreaming(sql)).toBe(false);
    expect(
      resolveAutoMaxParallelReadOnlyBatchItems([{ sql }], undefined, true),
    ).toBeUndefined();
  });

  it("ignores INTO in literals and comments", () => {
    expect(isLikelyReadOnlySql("SELECT 'INTO' AS label /* INTO ignored */")).toBe(true);
  });
  it("detects read-only SELECT statements conservatively", () => {
    expect(isLikelyReadOnlySql("SELECT * FROM Cliente")).toBe(true);
    expect(isLikelyReadOnlySql("  select top 10 codCliente from Cliente  ")).toBe(true);
    expect(isLikelyReadOnlySql("DELETE FROM Cliente WHERE CodCliente = 1")).toBe(false);
    expect(isLikelyReadOnlySql("SELECT 1; SELECT 2")).toBe(false);
    expect(isLikelyReadOnlySql("INSERT INTO Cliente (CodCliente) VALUES (1)")).toBe(
      false,
    );
  });

  it("suggests db streaming only for large TOP results", () => {
    expect(shouldAutoPreferDbStreaming("SELECT TOP 1000 * FROM Cliente")).toBe(true);
    expect(shouldAutoPreferDbStreaming("SELECT TOP 10 * FROM Cliente")).toBe(false);
    expect(shouldAutoPreferDbStreaming("SELECT * FROM Cliente")).toBe(false);
    expect(shouldAutoPreferDbStreaming("SELECT * FROM Cliente WHERE 1=0")).toBe(false);
    expect(shouldAutoPreferDbStreaming("SELECT 1")).toBe(false);
    expect(
      shouldAutoPreferDbStreaming("UPDATE Cliente SET Nome = 'x' WHERE CodCliente = 1"),
    ).toBe(false);
  });

  it("detects unbounded SELECT statements that may open inadvertent streams", () => {
    expect(isLikelyUnboundedSelectSql("SELECT * FROM Cliente")).toBe(true);
    expect(isLikelyUnboundedSelectSql("SELECT CodCliente FROM Cliente")).toBe(true);
    expect(isLikelyUnboundedSelectSql("SELECT TOP 10 * FROM Cliente")).toBe(false);
    expect(isLikelyUnboundedSelectSql("SELECT * FROM Cliente WHERE 1=0")).toBe(false);
    expect(isLikelyUnboundedSelectSql("DELETE FROM Cliente")).toBe(false);
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

  it("rejects bulk insert payloads exceeding the byte budget", () => {
    const columns = [{ name: "payload", type: "string" }];
    const rows = Array.from({ length: 200 }, () => ["x".repeat(60_000)]);

    expect(() => assertBulkInsertWithinHubLimits("dbo.Example", columns, rows)).toThrow(
      PlugValidationError,
    );
    expect(() => assertBulkInsertWithinHubLimits("dbo.Example", columns, rows)).toThrow(
      /exceeds the hub limit/i,
    );
  });

  it("counts unsampled large rows and accepts uneven payloads within budget", () => {
    const columns = [{ name: "payload", type: "string" }];
    const rows = Array.from({ length: 100 }, () => ["x"]);
    rows[1] = ["x".repeat(11 * 1024 * 1024)];
    expect(() => assertBulkInsertWithinHubLimits("Fixture", columns, rows)).toThrow(
      /exceeds the hub limit/,
    );
    rows[1] = ["x"];
    rows[0] = ["x".repeat(1024 * 1024)];
    expect(() => assertBulkInsertWithinHubLimits("Fixture", columns, rows)).not.toThrow();
  });

  it("preserves the exact JSON byte boundary with Unicode and escaping", () => {
    const table = "ação";
    const columns = [{ name: "payload", type: "string" }];
    const rows = Array.from({ length: 100 }, () => ['🌱\n"']);
    const bytes = Buffer.byteLength(JSON.stringify({ table, columns, rows }));
    rows[99][0] += "x".repeat(plugBulkInsertMaxJsonBytes - bytes);
    expect(Buffer.byteLength(JSON.stringify({ table, columns, rows }))).toBe(
      plugBulkInsertMaxJsonBytes,
    );
    expect(() => assertBulkInsertWithinHubLimits(table, columns, rows)).not.toThrow();
    rows[99][0] += "x";
    expect(() => assertBulkInsertWithinHubLimits(table, columns, rows)).toThrow(
      /exceeds the hub limit/,
    );
  });

  it("stops counting after exceeding the byte limit", () => {
    const rows = [["x".repeat(plugBulkInsertMaxJsonBytes)], ["unread"]];
    Object.defineProperty(rows, 1, {
      get: () => {
        throw new Error("read past limit");
      },
    });
    expect(() => assertBulkInsertWithinHubLimits("Fixture", [], rows)).toThrow(
      /exceeds the hub limit/,
    );
  });
});
