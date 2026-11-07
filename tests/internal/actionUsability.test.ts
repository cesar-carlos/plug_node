import { afterEach, describe, expect, it, vi } from "vitest";
import type { ILoadOptionsFunctions } from "n8n-workflow";
import { executeActionIoNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionIoExecution";
import { getAuthorizedActions } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionCatalogOptions";
import { ActionIoError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";
import login from "../fixtures/plug/login.success.json";
import fixtures from "../fixtures/action-io-shared.json";

const credentials = {
  user: "fixture@example.test",
  password: "hub-secret",
  agentId: "agent",
  clientToken: "local-token",
};
const setup = (parameters: Record<string, unknown>) =>
  createMockExecuteContext({
    credentials,
    parameters: {
      actionChannel: "socket",
      actionId: "a",
      actionKey: "k",
      actionInitial: true,
      actionClose: true,
      actionExecutionId: "e",
      actionMessageId: "m",
      actionSequence: 0,
      ...parameters,
    },
    responses: [{ statusCode: 200, body: login }],
  });
const runResult = fixtures.cases.find(
  (c) => c.name === "faithful terminal duplicate",
)!.payload;
const reply = (operation: string) =>
  operation === "run"
    ? runResult
    : operation === "validateRun"
      ? {
          valid: true,
          action_id: "a",
          action_type: "script",
          would_replay_existing_execution: false,
        }
      : {
          execution_id: "e",
          message_id: "m",
          sequence: 0,
          state: "accepted",
          confirmed_bytes: 0,
          next_input_sequence: 1,
          stdin_state: "open",
        };
afterEach(() => vi.unstubAllGlobals());
describe("action input and selection compatibility", () => {
  for (const channel of ["rest", "socket", "relay"])
    it.each(["validateRun", "run", "sendInput"])(
      channel + " sends exact UTF-8 for %s",
      async (operation) => {
        const context = setup({
          operation,
          actionChannel: channel,
          actionInputFormat: "text",
          actionText: "ação 🌱",
        });
        const send = vi.fn(
          async (command: { id: string; params: Record<string, unknown> }) => {
            expect(
              operation === "sendInput"
                ? command.params.data_base64
                : (command.params.io as Record<string, unknown>).initial_input_base64,
            ).toBe("YcOnw6NvIPCfjLE=");
            return { jsonrpc: "2.0", id: command.id, result: reply(operation) };
          },
        );
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_url: unknown, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));
            const response = await send(body.command);
            return Response.json({
              agentId: "agent",
              response: {
                type: "single",
                item: { id: response.id, success: true, result: response.result },
              },
            });
          }),
        );
        await executeActionIoNode(context, {
          supportsSocket: true,
          actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
        });
        expect(send).toHaveBeenCalledOnce();
      },
    );
  it.each(["", "line\r\n", "é".repeat(32768)])(
    "preserves empty input, explicit newlines and the UTF-8 byte boundary",
    async (text) => {
      const send = vi.fn(
        async (command: { id: string; params: Record<string, unknown> }) => {
          expect(command.params.data_base64).toBe(Buffer.from(text).toString("base64"));
          return { jsonrpc: "2.0", id: command.id, result: reply("sendInput") };
        },
      );
      await executeActionIoNode(
        setup({ operation: "sendInput", actionInputFormat: "text", actionText: text }),
        {
          supportsSocket: true,
          actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
        },
      );
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it.each(["é".repeat(32769), "x".repeat(65537), "\ud800", "\udc00", 123])(
    "rejects oversized or malformed text before dispatch",
    async (text) => {
      const factory = vi.fn();
      await expect(
        executeActionIoNode(
          setup({ operation: "run", actionInputFormat: "text", actionText: text }),
          { supportsSocket: true, actionIoTransportFactory: factory },
        ),
      ).rejects.toThrow();
      expect(factory).not.toHaveBeenCalled();
    },
  );
  it("keeps base64 as the missing-format default, without double encoding", async () => {
    const send = vi.fn(
      async (command: { id: string; params: Record<string, unknown> }) => {
        expect(command.params.data_base64).toBe("YcOnw6NvIPCfjLE=");
        return { jsonrpc: "2.0", id: command.id, result: reply("sendInput") };
      },
    );
    await executeActionIoNode(
      setup({ operation: "sendInput", actionBase64: "YcOnw6NvIPCfjLE=" }),
      {
        supportsSocket: true,
        actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
      },
    );
  });
  it.each([undefined, "manual", "catalog"])(
    "resolves only the selected action source (%s), without fetching a catalog at execution",
    async (source) => {
      const context = setup({
        operation: "validateRun",
        actionBase64: "",
        ...(source ? { actionSelection: source } : {}),
        actionCatalog: { mode: "list", value: source === "catalog" ? "a" : "ignored" },
        actionId: source === "catalog" ? "ignored" : "a",
      });
      const send = vi.fn(
        async (command: {
          id: string;
          method: string;
          params: Record<string, unknown>;
        }) => {
          expect(command.method).toBe("agent.action.validateRun");
          expect(command.params.action_id).toBe("a");
          return { jsonrpc: "2.0", id: command.id, result: reply("validateRun") };
        },
      );
      await executeActionIoNode(context, {
        supportsSocket: true,
        actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
      });
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it("does not fall back to the hidden manual ID when no catalog action is selected", async () => {
    const factory = vi.fn();
    await expect(
      executeActionIoNode(
        setup({
          operation: "run",
          actionSelection: "catalog",
          actionCatalog: { mode: "list", value: "" },
        }),
        { supportsSocket: true, actionIoTransportFactory: factory },
      ),
    ).rejects.toThrow("MISSING_CATALOG_ACTION");
    expect(factory).not.toHaveBeenCalled();
  });
  it.each([
    ["run", "Find Execution", true],
    ["sendInput", "Get Input Status", true],
    ["readIo", "último checkpoint consumido", false],
    ["cancel", "Get Execution", true],
  ] as const)(
    "provides recovery guidance for %s without replay",
    async (operation, hint, unknown) => {
      const context = setup({ operation, actionBase64: "" });
      const send = vi.fn(async () => {
        throw new ActionIoError("SOCKET_DISCONNECTED", unknown);
      });
      await expect(
        executeActionIoNode(context, {
          supportsSocket: true,
          actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
        }),
      ).rejects.toMatchObject({ description: expect.stringContaining(hint) });
      expect(send).toHaveBeenCalledOnce();
    },
  );
});
const optionContext = (parameters: Record<string, unknown>) => {
  const context = setup(parameters);
  return {
    ...context,
    getNodeParameter: (name: string, fallback: unknown) => parameters[name] ?? fallback,
  } as unknown as ILoadOptionsFunctions;
};
const action = {
  action_id: "a",
  name: "Echo",
  trigger_ids: [],
  io_eligible: true,
  public_description: null,
  stdin_description: null,
  stdout_description: null,
  stderr_description: null,
};
describe("authorized catalog dropdown", () => {
  for (const channel of ["rest", "socket", "relay"])
    it.each(["account", "separate"])(
      channel + " paginates using %s credentials",
      async (source) => {
        const context = optionContext({
          actionChannel: channel,
          agentCredentialSource: source,
        });
        const dispose = vi.fn();
        const send = vi.fn(
          async (command: {
            id: string;
            method: string;
            params: Record<string, unknown>;
          }) => {
            expect(command.method).toBe("agent.action.listAvailable");
            expect(command.params).toEqual({
              page_size: 50,
              client_token: "local-token",
              cursor: "opaque",
            });
            return {
              jsonrpc: "2.0",
              id: command.id,
              result: { actions: [action], next_cursor: "next" },
            };
          },
        );
        const factory = vi.fn(async () => Object.assign(send, { dispose }));
        vi.stubGlobal(
          "fetch",
          vi.fn(async (_url: unknown, init?: RequestInit) => {
            const body = JSON.parse(String(init?.body));
            const response = await send(body.command);
            return Response.json({
              agentId: "agent",
              response: {
                type: "single",
                item: { id: response.id, success: true, result: response.result },
              },
            });
          }),
        );
        expect(await getAuthorizedActions(context, factory, "opaque")).toMatchObject({
          results: [{ name: "Echo (a)", value: "a" }],
          paginationToken: "next",
        });
        expect(send).toHaveBeenCalledOnce();
        expect(context.getCredentials).toHaveBeenCalledTimes(
          source === "account" ? 1 : 2,
        );
        if (channel !== "rest") {
          expect(factory).toHaveBeenCalledWith(
            expect.objectContaining({ relay: channel === "relay", agentId: "agent" }),
          );
          expect(dispose).toHaveBeenCalledOnce();
        }
      },
    );
  it.each([undefined, ""])(
    "returns an empty final page without synthesizing options or fetching again",
    async (cursor) => {
      const send = vi.fn(async (command: { id: string }) => ({
        jsonrpc: "2.0",
        id: command.id,
        result: { actions: [], next_cursor: null },
      }));
      expect(
        await getAuthorizedActions(
          optionContext({ actionChannel: "socket" }),
          async () => Object.assign(send, { dispose: vi.fn() }),
          cursor,
        ),
      ).toEqual({ results: [] });
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it("propagates denied scope, adds source guidance and disposes the connection", async () => {
    const dispose = vi.fn();
    const send = vi.fn(async () => {
      throw new ActionIoError("ACTION_IO_UNAUTHORIZED", false, {
        reason: "scope_or_action_denied",
      });
    });
    await expect(
      getAuthorizedActions(
        optionContext({ actionChannel: "relay", agentCredentialSource: "account" }),
        async () => Object.assign(send, { dispose }),
      ),
    ).rejects.toMatchObject({
      code: "ACTION_IO_UNAUTHORIZED",
      description: expect.stringContaining("Account Credential"),
      details: { outcome_unknown: false },
    });
    expect(dispose).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledOnce();
  });
  it("rejects a repeated cursor and closes the connection", async () => {
    const dispose = vi.fn();
    const send = vi.fn(async (command: { id: string }) => ({
      jsonrpc: "2.0",
      id: command.id,
      result: { actions: [], next_cursor: "same" },
    }));
    await expect(
      getAuthorizedActions(
        optionContext({ actionChannel: "socket" }),
        async () => Object.assign(send, { dispose }),
        "same",
      ),
    ).rejects.toThrow("INVALID_RESPONSE");
    expect(dispose).toHaveBeenCalledOnce();
  });
  it("rejects invalid cursor before reading credentials", async () => {
    const context = optionContext({});
    await expect(getAuthorizedActions(context, vi.fn(), "x".repeat(129))).rejects.toThrow(
      "Invalid catalog cursor",
    );
    expect(context.getCredentials).not.toHaveBeenCalled();
  });
  it("registers the selector without changing legacy defaults or credential values", () => {
    const node = new PlugDatabase();
    const properties = node.description.properties;
    expect(node.methods.listSearch.getAuthorizedActions).toBeTypeOf("function");
    expect(properties.find((p) => p.name === "actionSelection")?.default).toBe("manual");
    expect(
      properties
        .filter((p) => p.name === "actionInputFormat")
        .every((p) => p.default === "base64"),
    ).toBe(true);
    expect(properties.find((p) => p.name === "agentCredentialSource")?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "Use Account Credential Only",
          value: "account",
        }),
        expect.objectContaining({
          name: "Use Separate Agent Credential",
          value: "separate",
        }),
      ]),
    );
  });
});
