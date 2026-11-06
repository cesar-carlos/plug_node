import { describe, expect, it, vi } from "vitest";
import { executeRelayCommand } from "../../shared/socket/relaySession";
import { executeRelayBatchCommand } from "../../shared/socket/relayBatchSession";
import * as codec from "../../shared/socket/payloadFrameCodec";
import type { PlugSession, RpcSingleCommand } from "../../shared/contracts/api";

const session: PlugSession = {
  credentials: {
    user: "fixture",
    password: "fixture",
    baseUrl: "https://fixture.invalid",
  },
  accessToken: "fixture",
};
const command: RpcSingleCommand = {
  jsonrpc: "2.0",
  id: "a",
  method: "sql.execute",
  params: { sql: "SELECT 1" },
};
describe("relay cancellation before dispatch", () => {
  for (const batch of [false, true])
    for (const fastPath of [false, true])
      it.each(["before", "encoding"])(
        `batch=${batch} fastPath=${fastPath} cancellation %s`,
        async (phase) => {
          const controller = new AbortController();
          const reason = new Error("cancelled by workflow");
          const handlers = new Map<string, Set<(payload: unknown) => void>>();
          const transport = {
            connected: true,
            connect: vi.fn(),
            disconnect: vi.fn(),
            emit: vi.fn(),
            on(event: string, handler: (payload: unknown) => void) {
              const set = handlers.get(event) ?? new Set();
              set.add(handler);
              handlers.set(event, set);
            },
            off(event: string, handler: (payload: unknown) => void) {
              handlers.get(event)?.delete(handler);
            },
          };
          const encode = codec.encodePayloadFrameAsync;
          const spy = vi
            .spyOn(codec, "encodePayloadFrameAsync")
            .mockImplementation(async (...args) => {
              const frame = await encode(...args);
              controller.abort(reason);
              return frame;
            });
          if (phase === "before") controller.abort(reason);
          try {
            const input = {
              transport,
              session,
              agentId: "agent",
              responseMode: "aggregatedJson" as const,
              managedTransport: true,
              reusedConversationId: "conversation",
              signal: controller.signal,
              fastPath,
            };
            await expect(
              batch
                ? executeRelayBatchCommand({ ...input, commands: [command] })
                : executeRelayCommand({ ...input, command }),
            ).rejects.toBe(reason);
            expect(
              transport.emit.mock.calls.some(
                ([event]) =>
                  event === "relay:rpc.request" || event === "relay:rpc.request.batch",
              ),
            ).toBe(false);
            expect([...handlers.values()].every((set) => set.size === 0)).toBe(true);
            expect(spy).toHaveBeenCalledTimes(phase === "before" ? 0 : 1);
          } finally {
            spy.mockRestore();
          }
        },
      );
});
