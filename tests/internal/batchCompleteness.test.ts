import { describe, expect, it } from "vitest";
import { executeRestCommand } from "../../shared/rest/client";
import {
  executeConsumerCommand,
  type ConsumerSocketTransport,
} from "../../shared/socket/consumerCommandSession";
import type {
  PlugSession,
  PlugHttpRequester,
  RpcSingleCommand,
} from "../../shared/contracts/api";

const session: PlugSession = {
  credentials: {
    user: "fixture",
    password: "fixture",
    baseUrl: "https://fixture.invalid",
  },
  accessToken: "fixture",
};
const cases: {
  name: string;
  ids: (string | null)[];
  replies: (string | undefined)[];
  valid: boolean;
  forceNotification?: boolean;
  rows?: number;
  single?: boolean;
}[] = [
  { name: "empty", ids: ["a", "b"], replies: [], valid: false },
  { name: "partial", ids: ["a", "b"], replies: ["a"], valid: false },
  { name: "extra", ids: ["a"], replies: ["a", "b"], valid: false },
  { name: "reordered", ids: ["a", "b"], replies: ["b", "a"], valid: true },
  {
    name: "legacy missing IDs",
    ids: ["a", "b"],
    replies: [undefined, undefined],
    valid: true,
  },
  { name: "partial legacy", ids: ["a", "b"], replies: [undefined], valid: false },
  { name: "mixed notification", ids: ["a", null], replies: ["a"], valid: true },
  {
    name: "missing reply with notification",
    ids: ["a", null],
    replies: [],
    valid: false,
  },
  { name: "only notifications", ids: [null, null], replies: [], valid: true },
];
cases.push(
  {
    name: "false notification single",
    ids: ["a"],
    replies: [],
    valid: false,
    forceNotification: true,
    single: true,
  },
  {
    name: "false notification batch",
    ids: ["a", null],
    replies: [],
    valid: false,
    forceNotification: true,
  },
  {
    name: "real notification single",
    ids: [null],
    replies: [],
    valid: true,
    single: true,
  },
);
for (const channel of ["rest", "socket"] as const)
  describe(`${channel} batch completeness`, () => {
    it.each(
      channel === "socket"
        ? [
            ...cases,
            ...[0, 1, 2].map((rows) => ({
              name: `batch rows ${rows}`,
              ids: ["a", "b"],
              replies: ["a", "b"],
              rows,
              valid: rows <= 1,
            })),
          ]
        : cases,
    )("$name", async ({ ids, replies, valid, forceNotification, rows, single }) => {
      const command: RpcSingleCommand[] = ids.map((id) => ({
        jsonrpc: "2.0",
        id,
        method: "sql.execute",
        params: { sql: "SELECT 1" },
      }));
      const response = {
        type: "batch",
        success: true,
        items: replies.map((id) => ({
          id,
          success: true,
          result: { rows: Array.from({ length: rows ?? 0 }, () => ({ value: 1 })) },
        })),
      };
      const notification = forceNotification || ids.every((id) => id === null);
      let dispatches = 0;
      const handlers = new Map<string, Set<(payload: unknown) => void>>();
      const transport: ConsumerSocketTransport = {
        connected: true,
        connect() {},
        disconnect() {},
        on(event, handler) {
          const listeners = handlers.get(event) ?? new Set();
          listeners.add(handler);
          handlers.set(event, listeners);
        },
        off(event, handler) {
          handlers.get(event)?.delete(handler);
        },
        emit(event, payload) {
          if (event !== "agents:command") return;
          dispatches++;
          queueMicrotask(() => {
            for (const handler of handlers.get("agents:command_response") ?? [])
              handler({
                success: true,
                requestId: (payload as { requestId: string }).requestId,
                response: notification
                  ? { type: "notification", accepted: true, acceptedCommands: 2 }
                  : response,
              });
          });
        },
      };
      const requester: PlugHttpRequester = async <T>() => {
        dispatches++;
        return {
          statusCode: notification ? 202 : 200,
          headers: {},
          body: {
            agentId: "agent",
            requestId: "hub",
            ...(notification
              ? { notification: true, acceptedCommands: 2 }
              : { response }),
          } as T,
        };
      };
      const result =
        channel === "rest"
          ? executeRestCommand(requester, session, {
              operation: "executeBatch",
              channel,
              agentId: "agent",
              responseMode: "aggregatedJson",
              command: single ? command[0] : command,
            })
          : executeConsumerCommand({
              bufferLimits: rows === undefined ? undefined : { maxBufferedRows: 2 },
              transport,
              session,
              agentId: "agent",
              command: single ? command[0] : command,
              responseMode: "aggregatedJson",
            });
      if (valid) await expect(result).resolves.toMatchObject({ notification });
      else
        await expect(result).rejects.toMatchObject({
          code: rows === undefined ? "PLUG_VALIDATION_ERROR" : "SOCKET_BUFFER_LIMIT",
          retryable: false,
        });
      expect(dispatches).toBe(1);
      expect([...handlers.values()].every((listeners) => listeners.size === 0)).toBe(
        true,
      );
    });
  });
