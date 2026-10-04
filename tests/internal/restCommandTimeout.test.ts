import { describe, expect, it, vi } from "vitest";
import type {
  BuiltCommandRequest,
  PlugHttpRequester,
  PlugSession,
  RpcSingleCommand,
} from "../../shared/contracts/api";
import { executeRestCommand } from "../../shared/rest/client";

const session: PlugSession = {
  credentials: {
    user: "fixture",
    password: "fixture",
    baseUrl: "https://fixture.invalid/api/v1",
  },
  accessToken: "fixture",
};
const sql = (method: string, timeout: number): RpcSingleCommand => ({
  jsonrpc: "2.0",
  id: method,
  method,
  params: { options: { timeout_ms: timeout } },
});

describe("REST command deadlines", () => {
  it.each([
    { command: sql("rpc.discover", 1), hub: 30_000, transport: 35_000 },
    {
      command: sql("sql.execute", 20_000),
      timeoutMs: 15_000,
      hub: 25_000,
      transport: 30_000,
    },
    {
      command: sql("sql.bulkInsert", 45_000),
      timeoutMs: 5_000,
      hub: 50_000,
      transport: 55_000,
    },
    {
      command: [
        sql("sql.execute", 10_000),
        sql("sql.executeBatch", 60_000),
        sql("sql.bulkInsert", 90_000),
      ],
      hub: 95_000,
      transport: 100_000,
    },
    { command: sql("sql.execute", 800_000), hub: 360_000, transport: 365_000 },
  ])(
    "should send hub wait $hub with a separate HTTP deadline $transport",
    async ({ command, timeoutMs, hub, transport }) => {
      const requester: PlugHttpRequester = vi.fn().mockResolvedValue({
        statusCode: 200,
        headers: {},
        body: {
          agentId: "agent",
          requestId: "request",
          response: { jsonrpc: "2.0", id: "result", result: { rows: [] } },
        },
      });
      const before = structuredClone(command);
      const request: BuiltCommandRequest = {
        operation: "executeSql",
        channel: "rest",
        responseMode: "aggregatedJson",
        agentId: "agent",
        command,
        timeoutMs,
      };
      await executeRestCommand(requester, session, request);
      expect(requester).toHaveBeenCalledWith(
        expect.objectContaining({
          timeoutMs: transport,
          body: expect.objectContaining({ timeoutMs: hub, command }),
        }),
      );
      expect(command).toEqual(before);
    },
  );
});
