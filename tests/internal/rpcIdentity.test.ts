import { describe, expect, it } from "vitest";
import { assertRpcResponseIdentity } from "../../shared/contracts/rpcIdentity";
import { executeRestCommand } from "../../shared/rest/client";
import type {
  BuiltCommandRequest,
  PlugHttpRequester,
  PlugSession,
} from "../../shared/contracts/api";

describe("RPC response identity", () => {
  it("checks completeness even when the Hub generates request IDs", () => {
    expect(() => assertRpcResponseIdentity([], [{}, {}])).toThrow(/incomplete/);
    expect(() =>
      assertRpcResponseIdentity([{ id: "generated-1" }, { id: "generated-2" }], [{}, {}]),
    ).not.toThrow();
    expect(() =>
      assertRpcResponseIdentity([], [{ id: null }, { id: null }]),
    ).not.toThrow();
  });
  it.each([{ id: 7 }, { id: "7" }, {}])(
    "preserves numeric IDs and legacy missing IDs (%j)",
    (item) => {
      expect(() =>
        assertRpcResponseIdentity({ type: "single", item }, { id: 7 }),
      ).not.toThrow();
    },
  );
  it("accepts reordered batches and rejects foreign or repeated IDs", () => {
    const commands = [{ id: "one" }, { id: 2 }];
    expect(() =>
      assertRpcResponseIdentity([{ id: "2" }, { id: "one" }], commands),
    ).not.toThrow();
    for (const items of [
      [{ id: "foreign" }],
      [{ id: "one" }, { id: "one" }],
      [{ id: null }],
    ]) {
      expect(() => assertRpcResponseIdentity({ type: "batch", items }, commands)).toThrow(
        /identity/,
      );
    }
  });
  it("preserves hub-generated IDs and notifications", () => {
    expect(() => assertRpcResponseIdentity({ id: "generated" }, {})).not.toThrow();
    expect(() =>
      assertRpcResponseIdentity({ type: "notification" }, { id: null }),
    ).not.toThrow();
    expect(() =>
      assertRpcResponseIdentity({ id: "hub" }, { id: "client" }, "hub"),
    ).not.toThrow();
  });
});

describe("REST response correlation", () => {
  it.each([
    { agentId: "other-agent", id: "cmd", valid: false },
    { agentId: "agent", id: "other-command", valid: false },
    { agentId: "agent", id: "cmd", valid: true },
    { agentId: "agent", id: "hub", valid: true },
    { agentId: "agent", id: undefined, valid: true },
  ])("checks response identity (%j)", async ({ agentId, id, valid }) => {
    const requester: PlugHttpRequester = async <T>() => ({
      statusCode: 200,
      headers: {},
      body: {
        agentId,
        requestId: "hub",
        response: {
          type: "single",
          success: true,
          item: { id, success: true, result: { rows: [] } },
        },
      } as T,
    });
    const session: PlugSession = {
      credentials: {
        user: "fixture",
        password: "fixture",
        baseUrl: "https://fixture.invalid",
      },
      accessToken: "fixture",
    };
    const request: BuiltCommandRequest = {
      operation: "executeSql",
      channel: "rest",
      agentId: "agent",
      responseMode: "aggregatedJson",
      command: {
        jsonrpc: "2.0",
        id: "cmd",
        method: "sql.execute",
        params: { sql: "SELECT 1" },
      },
    };
    const result = executeRestCommand(requester, session, request);
    if (valid) await expect(result).resolves.toMatchObject({ agentId: "agent" });
    else
      await expect(result).rejects.toMatchObject({
        code: "PLUG_VALIDATION_ERROR",
        retryable: false,
      });
  });
});
