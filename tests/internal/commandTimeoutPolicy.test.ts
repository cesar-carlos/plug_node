import { describe, expect, it } from "vitest";
import type { RpcSingleCommand } from "../../shared/contracts/api";
import { resolveCommandTimeoutPolicy } from "../../shared/socket/commandTimeoutPolicy";

const sql = (method: string, timeout: number): RpcSingleCommand => ({
  jsonrpc: "2.0",
  method,
  params: { options: { timeout_ms: timeout } },
});

describe("resolveCommandTimeoutPolicy", () => {
  it("should keep connection wait independent of a short hub deadline", () => {
    expect(resolveCommandTimeoutPolicy({ timeoutMs: 100 })).toEqual({
      hubWaitTimeoutMs: 100,
      commandTimeoutMs: 5_100,
      connectTimeoutMs: 10_000,
    });
    expect(
      resolveCommandTimeoutPolicy({ timeoutMs: 100, connectTimeoutMs: 500 })
        .connectTimeoutMs,
    ).toBe(500);
  });

  it("should explicitly default hub wait to 30s and transport to 35s", () => {
    expect(resolveCommandTimeoutPolicy({})).toEqual({
      hubWaitTimeoutMs: 30_000,
      commandTimeoutMs: 35_000,
      connectTimeoutMs: 10_000,
    });
  });
  it.each(["sql.execute", "sql.executeBatch", "sql.bulkInsert"])(
    "should preserve the agent timeout and add both margins for %s",
    (method) => {
      const command = sql(method, 20_000);
      expect(resolveCommandTimeoutPolicy({ command, timeoutMs: 15_000 })).toMatchObject({
        hubWaitTimeoutMs: 25_000,
        commandTimeoutMs: 30_000,
      });
      expect(command.params).toEqual({ options: { timeout_ms: 20_000 } });
    },
  );
  it("should use the maximum SQL timeout in JSON-RPC arrays", () => {
    expect(
      resolveCommandTimeoutPolicy({
        command: [
          sql("sql.execute", 10_000),
          sql("sql.executeBatch", 40_000),
          sql("sql.bulkInsert", 50_000),
        ],
      }),
    ).toMatchObject({ hubWaitTimeoutMs: 55_000, commandTimeoutMs: 60_000 });
  });
  it("should cap the hub deadline while keeping its full transport margin", () => {
    expect(
      resolveCommandTimeoutPolicy({
        command: sql("sql.execute", 900_000),
        timeoutMs: 800_000,
        connectTimeoutMs: 40_000,
      }),
    ).toEqual({
      hubWaitTimeoutMs: 360_000,
      commandTimeoutMs: 365_000,
      connectTimeoutMs: 10_000,
    });
  });
  it("should honor a longer requested hub wait and ignore non-SQL options", () => {
    expect(
      resolveCommandTimeoutPolicy({
        command: sql("sql.execute", 1000),
        timeoutMs: 60_000,
      }).hubWaitTimeoutMs,
    ).toBe(60_000);
    expect(
      resolveCommandTimeoutPolicy({ command: sql("rpc.discover", 100_000) })
        .hubWaitTimeoutMs,
    ).toBe(30_000);
  });
  it.each([0, -1, Infinity, NaN])("should reject invalid timeout %s", (timeoutMs) => {
    expect(() => resolveCommandTimeoutPolicy({ timeoutMs })).toThrow(/positive finite/);
  });
});
