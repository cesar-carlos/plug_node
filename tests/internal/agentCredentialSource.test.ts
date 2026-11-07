import { ActionIoError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { executeActionIoNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionIoExecution";
import { executeSqlExtensionNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/sqlExtensionExecution";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";
import login from "../fixtures/plug/login.success.json";

const account = {
  user: "fixture@example.test",
  password: "hub-secret",
  agentId: "account-agent",
  clientToken: "account-token",
};
const separate = { agentId: "separate-agent", clientToken: "separate-token" };
const health = {
  status: "healthy",
  timestamp: "2026-01-01T00:00:00Z",
  version: "1",
  pool: { size: 0 },
  sql_queue: { enabled: false },
  queries: {
    total: 0,
    errors: 0,
    success_rate: 1,
    avg_latency_ms: 0,
    p95_latency_ms: 0,
    p99_latency_ms: 0,
  },
  uptime_seconds: 0,
};
const runners = [
  {
    name: "Action I/O",
    execute: executeActionIoNode,
    operation: "listAvailable",
    result: { actions: [], next_cursor: null },
  },
  {
    name: "SQL Extensions",
    execute: executeSqlExtensionNode,
    operation: "agent.getHealth",
    result: health,
  },
];
afterEach(() => vi.unstubAllGlobals());
for (const runner of runners)
  describe(runner.name + " credential source", () => {
    for (const channel of ["rest", "socket", "relay"])
      it.each([undefined, "separate", "account"])(
        channel + " uses only the selected credential (%s)",
        async (source) => {
          const context = createMockExecuteContext({
            credentials: account,
            parameters: {
              operation: runner.operation,
              actionChannel: channel,
              ...(source ? { agentCredentialSource: source } : {}),
            },
            responses: [{ statusCode: 200, body: login }],
          });
          const credentials = vi
            .spyOn(context, "getCredentials")
            .mockImplementation(async (name) =>
              name === "plugAgentApi" ? separate : account,
            );
          const expected = source === "account" ? account : separate;
          const send = vi.fn(
            async (command: { id: string; params: { client_token: string } }) => {
              expect(command.params.client_token).toBe(expected.clientToken);
              return { jsonrpc: "2.0", id: command.id, result: runner.result };
            },
          );
          const factory = vi.fn(async () => Object.assign(send, { dispose: vi.fn() }));
          const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
            const wire = JSON.parse(String(init?.body));
            expect(wire.agentId).toBe(expected.agentId);
            const response = await send(wire.command);
            return Response.json({
              agentId: wire.agentId,
              response: {
                type: "single",
                item: { id: response.id, success: true, result: response.result },
              },
            });
          });
          vi.stubGlobal("fetch", fetcher);
          const output = await runner.execute(context, {
            supportsSocket: true,
            actionIoTransportFactory: factory,
          });
          expect(output[0][0].json).toEqual(runner.result);
          expect(send).toHaveBeenCalledOnce();
          expect(credentials.mock.calls.map(([name]) => name)).toEqual(
            source === "account"
              ? ["plugDatabaseAccountApi"]
              : ["plugDatabaseAccountApi", "plugAgentApi"],
          );
          if (channel !== "rest")
            expect(factory).toHaveBeenCalledWith(
              expect.objectContaining({
                agentId: expected.agentId,
                relay: channel === "relay",
              }),
            );
        },
      );
    it.each(["agentId", "clientToken"])(
      "rejects missing account %s before login without borrowing the separate credential",
      async (field) => {
        const context = createMockExecuteContext({
          credentials: { ...account, [field]: "" },
          parameters: { agentCredentialSource: "account" },
          responses: [],
        });
        await expect(runner.execute(context, { supportsSocket: true })).rejects.toThrow(
          "Default Agent ID and Default Client Token",
        );
        expect(context.getCredentials).toHaveBeenCalledTimes(1);
        expect(context.httpRequestMock).not.toHaveBeenCalled();
      },
    );
    it("does not fall back to account defaults when the separate credential is incomplete", async () => {
      const context = createMockExecuteContext({
        credentials: account,
        parameters: {},
        responses: [],
      });
      vi.spyOn(context, "getCredentials").mockImplementation(async (name) =>
        name === "plugAgentApi" ? { agentId: "other" } : account,
      );
      await expect(runner.execute(context, { supportsSocket: true })).rejects.toThrow(
        "Local Client Token",
      );
      expect(context.httpRequestMock).not.toHaveBeenCalled();
    });
    it("rejects an unknown source before login", async () => {
      const context = createMockExecuteContext({
        credentials: account,
        parameters: { agentCredentialSource: "invalid" },
        responses: [],
      });
      await expect(runner.execute(context, { supportsSocket: true })).rejects.toThrow(
        "Agent Credential Source",
      );
      expect(context.httpRequestMock).not.toHaveBeenCalled();
    });
    it("propagates agent denial without trying the other credential", async () => {
      const context = createMockExecuteContext({
        credentials: account,
        parameters: {
          agentCredentialSource: "account",
          actionChannel: "socket",
          operation: runner.operation,
        },
        responses: [{ statusCode: 200, body: login }],
      });
      const send = vi.fn(async () => {
        throw new Error("scope_or_action_denied");
      });
      await expect(
        runner.execute(context, {
          supportsSocket: true,
          actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
        }),
      ).rejects.toThrow();
      expect(context.getCredentials).toHaveBeenCalledTimes(1);
      expect(send).toHaveBeenCalledOnce();
    });
    it.each(["account", "separate"])(
      "explains denied scope for %s without changing outcome metadata",
      async (source) => {
        const context = createMockExecuteContext({
          credentials: account,
          parameters: {
            agentCredentialSource: source,
            actionChannel: "socket",
            operation: runner.operation,
          },
          responses: [{ statusCode: 200, body: login }],
          continueOnFail: true,
        });
        const code =
          runner.name === "Action I/O"
            ? "ACTION_IO_UNAUTHORIZED"
            : "SQL_OPERATION_AUTHORIZATION_DENIED";
        const send = vi.fn(async () => {
          throw new ActionIoError(code, false, { reason: "scope_or_action_denied" });
        });
        const output = await runner.execute(context, {
          supportsSocket: true,
          actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
        });
        expect(output[0][0].json.error).toMatchObject({
          code,
          retryable: false,
          description: expect.stringContaining(
            source === "account"
              ? "Origem selecionada: Account Credential"
              : "Origem selecionada: Separate Agent Credential",
          ),
          details: {
            reason: "scope_or_action_denied",
            effects_possible: false,
            outcome_unknown: false,
          },
        });
        expect(JSON.stringify(output)).not.toContain(account.clientToken);
        expect(JSON.stringify(output)).not.toContain(account.password);
        expect(send).toHaveBeenCalledOnce();
      },
    );
    it("sanitizes a separate credential loading failure before contacting the Hub", async () => {
      const context = createMockExecuteContext({
        credentials: account,
        parameters: {},
        responses: [],
      });
      vi.spyOn(context, "getCredentials").mockImplementation(async (name) => {
        if (name === "plugAgentApi")
          throw new Error("vault secret " + account.clientToken);
        return account;
      });
      await expect(
        runner.execute(context, { supportsSocket: true }),
      ).rejects.toMatchObject({
        description: expect.stringContaining("Separate Agent Credential"),
        message: "Não foi possível carregar a credencial de agente selecionada.",
      });
      expect(context.httpRequestMock).not.toHaveBeenCalled();
    });
  });
