import { describe, expect, it, vi } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import fixtures from "../fixtures/action-io-shared.json";
import {
  actionIoBlockSchema,
  actionIoParamsSchemas,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/params";
import {
  isValidActionIoResult,
  isValidActionIoResponse,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/results";
import {
  ActionIoError,
  callActionIo,
  nextActionIoOffsets,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import { createRestActionIoTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/actionIoTransport";
import { serializeErrorForContinueOnFail } from "../../packages/n8n-nodes-plug-database/generated/shared/output/errorOutput";
import { isRecord } from "../../packages/n8n-nodes-plug-database/generated/shared/utils/json";
import { supportsActionIo } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/capability";

import { callSqlExtension } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/sqlOperation/client";
import { matchesActionIoExpectation } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/expectation";

it("accepts exactly canonical base64 blocks within the decoded byte budget", () => {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const cases = ["", "AAA", "AA==\n", "AA\n=", "AA-_", "=AAA", "AAAA===="];
  for (const ch of alphabet) cases.push("A" + ch + "==", "AA" + ch + "=");
  for (const size of [65535, 65536, 65537, 65538])
    cases.push(Buffer.alloc(size, 255).toString("base64"));
  for (const value of cases) {
    const decoded = Buffer.from(value, "base64");
    expect(actionIoBlockSchema.safeParse(value).success).toBe(
      decoded.length <= 65536 && decoded.toString("base64") === value,
    );
  }
});

it.each([false, true])(
  "preserves response bytes and byte limits with split=%s",
  async (split) => {
    const bytes = Buffer.from(
      JSON.stringify({
        agentId: "a",
        response: { type: "single", item: { id: "x", success: true, result: "ação" } },
      }),
    );
    const cut = bytes.indexOf(Buffer.from("ç")) + 1;
    const run = (maxResponseBytes: number) =>
      createRestActionIoTransport({
        endpoint: "http://fixture.invalid",
        agentId: "a",
        bearerToken: () => "test",
        maxResponseBytes,
        fetch: async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                for (const part of split
                  ? [bytes.subarray(0, cut), bytes.subarray(cut)]
                  : [bytes])
                  controller.enqueue(part);
                controller.close();
              },
            }),
          ),
      })({ jsonrpc: "2.0", id: "x", method: "test", params: {} });
    await expect(run(bytes.length)).resolves.toMatchObject({ result: "ação" });
    await expect(run(bytes.length - 1)).rejects.toMatchObject({
      code: "HTTP_RESPONSE_TOO_LARGE",
    });
  },
);

it("applies the inclusive UTF-8 budget to standalone results and entire envelopes", () => {
  const method = "agent.action.readIo";
  const budget = 524288;
  const result = {
    execution_id: "é",
    events: [],
    next_sequence: 0,
    terminal: false,
    output_complete: false,
  };
  const envelope = { jsonrpc: "2.0", id: "x", result, meta: "" };
  envelope.meta = "x".repeat(budget - Buffer.byteLength(JSON.stringify(envelope)));
  expect(isValidActionIoResponse(method, envelope)).toBe(true);
  envelope.meta += "x";
  expect(isValidActionIoResponse(method, envelope)).toBe(false);
  result.execution_id += "x".repeat(budget - Buffer.byteLength(JSON.stringify(result)));
  expect(isValidActionIoResult(method, result)).toBe(true);
  result.execution_id += "x";
  expect(isValidActionIoResult(method, result)).toBe(false);
  expect(
    isValidActionIoResponse(
      method,
      Object.defineProperty({}, "result", { value: result }),
    ),
  ).toBe(false);
  expect(isValidActionIoResponse(method, { result, toJSON: () => ({}) })).toBe(false);
});
it.each(["constructor", "__proto__", "toString"])(
  "rejects inherited method %s before dispatch",
  async (method) => {
    const send = vi.fn();
    for (const call of [callSqlExtension, callActionIo])
      await expect(call(send, method, {}, "token")).rejects.toMatchObject({
        code: "INVALID_REQUEST",
        details: { outcome_unknown: false },
      });
    expect(isValidActionIoResult(method, {})).toBe(false);
    expect(send).not.toHaveBeenCalled();
  },
);
it("counts decoded output bytes across padded and unpadded events", () => {
  const events = ["AA==", "AP8=", "AAAA"].map((data_base64, i) => ({
    type: "output",
    sequence: i + 1,
    data_base64,
  }));
  expect(matchesActionIoExpectation({ events }, { afterSequence: 0, maxBytes: 6 })).toBe(
    true,
  );
  expect(matchesActionIoExpectation({ events }, { afterSequence: 0, maxBytes: 5 })).toBe(
    false,
  );
});
it("preserves an explicit unknown HTTP outcome when effects are marked false", async () => {
  const transport = createRestActionIoTransport({
    endpoint: "http://fixture.invalid",
    agentId: "a",
    bearerToken: () => "hub",
    fetch: async () =>
      Response.json(
        {
          success: false,
          error: {
            code: "UNKNOWN",
            details: { effects_possible: false, outcome_unknown: true },
          },
        },
        { status: 409 },
      ),
  });
  await expect(
    transport({ id: "x", jsonrpc: "2.0", method: "agent.action.run", params: {} }),
  ).rejects.toMatchObject({
    code: "UNKNOWN",
    retryable: false,
    details: { outcome_unknown: true },
  });
});
describe("faithful I/O contracts", () => {
  it("surfaces catalog denial with permission guidance and keeps it distinct from an empty page", async () => {
    const send = vi.fn(async (command: { id: string }) => ({
      jsonrpc: "2.0",
      id: command.id,
      error: {
        code: -32003,
        message: "private native diagnostic",
        data: {
          failure_code: "ACTION_IO_UNAUTHORIZED",
          reason: "scope_or_action_denied",
        },
      },
    }));
    await expect(callActionIo(send, "listAvailable", {}, "test")).rejects.toMatchObject({
      code: "ACTION_IO_UNAUTHORIZED",
      message: "O agente negou acesso ao catálogo de ações.",
      description: expect.stringContaining("agent_actions.list"),
      retryable: false,
      details: {
        rpc_code: -32003,
        reason: "scope_or_action_denied",
        effects_possible: false,
      },
    });
    expect(send).toHaveBeenCalledOnce();
  });
  it.each([{ page_size: 0 }, { page_size: 51 }, { cursor: "x".repeat(129) }])(
    "rejects invalid catalog pagination before dispatch",
    async (params) => {
      const send = vi.fn();
      await expect(
        callActionIo(send, "listAvailable", params, "token"),
      ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("validates public catalog fields, page size and cursor progress without replay", async () => {
    const entry = {
      action_id: "a",
      name: "Saved",
      trigger_ids: ["t"],
      io_eligible: true,
      public_description: null,
      stdin_description: null,
      stdout_description: null,
      stderr_description: null,
    };
    for (const result of [
      { actions: [entry, entry], next_cursor: null },
      { actions: [], next_cursor: "previous" },
      { actions: [{ ...entry, command: "private" }], next_cursor: null },
    ]) {
      const send = vi.fn(async (c: { id: string }) => ({
        jsonrpc: "2.0",
        id: c.id,
        result,
      }));
      await expect(
        callActionIo(
          send,
          "listAvailable",
          { page_size: 1, cursor: "previous" },
          "token",
        ),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(send).toHaveBeenCalledOnce();
    }
  });
  it.each([" ", " e", "e "])(
    "rejects noncanonical identity %j before dispatch",
    async (execution_id) => {
      const send = vi.fn();
      await expect(
        callActionIo(send, "cancel", { execution_id }, "token"),
      ).rejects.toMatchObject({
        code: "NON_CANONICAL_IDENTITY",
        details: { outcome_unknown: false },
      });
      expect(send).not.toHaveBeenCalled();
    },
  );
  it("matches the explicitly required sibling Hub corpus", () => {
    const root = process.env.PLUG_SERVER_ROOT ?? resolve("../plug_server");
    const file = resolve(root, "contracts/action_io_shared_fixtures.json");
    if (!existsSync(file)) {
      if (process.env.REQUIRE_PLUG_SERVER_CONTRACT === "1")
        throw new Error("Required Hub corpus is absent");
      return;
    }
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(fixtures);
  });
  for (const fixture of fixtures.cases)
    it(fixture.name, () => {
      const payload: unknown = fixture.payload;
      const valid =
        fixture.kind === "capability"
          ? supportsActionIo(payload)
          : fixture.kind === "params"
            ? actionIoParamsSchemas[
                fixture.method.replace("agent.action.", "")
              ]?.safeParse(payload).success
            : fixture.kind === "result"
              ? isValidActionIoResult(fixture.method, payload)
              : isRecord(payload) &&
                payload.jsonrpc === "2.0" &&
                typeof payload.id === "string" &&
                isRecord(payload.error) &&
                typeof payload.error.code === "number" &&
                typeof payload.error.message === "string" &&
                (payload.error.data === undefined || isRecord(payload.error.data)) &&
                isValidActionIoResponse(fixture.method, payload, { faithfulIo: true });
      expect(valid).toBe(fixture.valid);
    });
  it("never repeats a dispatch after auth expiry or lost response", async () => {
    const send = vi.fn().mockRejectedValue(new Error("401 secret native error"));
    await expect(
      callActionIo(
        send,
        "sendInput",
        { execution_id: "e", message_id: "m", sequence: 0, data_base64: "AP8=" },
        "secret",
      ),
    ).rejects.toMatchObject({ retryable: false, details: { outcome_unknown: true } });
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("validates input size before dispatch and accepts empty messages", async () => {
    const send = vi.fn();
    await expect(
      callActionIo(
        send,
        "sendInput",
        {
          execution_id: "e",
          message_id: "m",
          sequence: 0,
          data_base64: "A".repeat(90000),
        },
        "secret",
      ),
    ).rejects.toMatchObject({ details: { outcome_unknown: false } });
    expect(send).not.toHaveBeenCalled();
    expect(
      actionIoParamsSchemas.sendInput.safeParse({
        execution_id: "e",
        message_id: "m",
        sequence: 0,
        data_base64: "",
      }).success,
    ).toBe(true);
  });
  it("preserves safe reconciliation data without credentials or native messages", () => {
    const error = new ActionIoError("ACTION_OUTCOME_UNKNOWN", true, {
      rpc_code: -32000,
      cleanup_failed: true,
      confirmed_bytes: null,
      failure_code: "WRITE_UNKNOWN",
      diagnostic_id: "d",
      technical_message: "secret",
      client_token: "secret",
    });
    expect(serializeErrorForContinueOnFail(error)).toMatchObject({
      retryable: false,
      details: {
        rpc_code: -32000,
        cleanup_failed: true,
        confirmed_bytes: null,
        failure_code: "WRITE_UNKNOWN",
      },
    });
    expect(JSON.stringify(serializeErrorForContinueOnFail(error))).not.toContain(
      "secret",
    );
  });
  it("rejects gaps across pages without modifying the committed checkpoint", () => {
    const offsets = { stdout: 2, stderr: 0 };
    expect(
      nextActionIoOffsets(
        {
          events: [{ type: "output", stream: "stdout", offset: 2, data_base64: "AP8=" }],
        },
        offsets,
      ),
    ).toEqual({ stdout: 4, stderr: 0 });
    expect(offsets.stdout).toBe(2);
    expect(() =>
      nextActionIoOffsets(
        {
          events: [{ type: "output", stream: "stdout", offset: 1, data_base64: "AA==" }],
        },
        offsets,
      ),
    ).toThrow();
  });
  it("serializes the command forwarded by a custom transport", async () => {
    const rest = createRestActionIoTransport({
      endpoint: "http://fixture.invalid",
      agentId: "a",
      bearerToken: () => "hub",
      fetch: async (_url, init) => {
        const { command } = JSON.parse(String(init?.body));
        expect(command.params.trace_id).toBe("forwarded");
        return Response.json({
          agentId: "a",
          response: {
            type: "single",
            item: {
              id: command.id,
              success: true,
              result: { actions: [], next_cursor: null },
            },
          },
        });
      },
    });
    await expect(
      callActionIo(
        (command) => {
          Object.assign(command.params, { trace_id: "forwarded" });
          return rest(command);
        },
        "listAvailable",
        {},
        "agent",
      ),
    ).resolves.toMatchObject({ actions: [] });
  });
  it("uses one bounded REST request and separates Hub and agent credentials", async () => {
    const agentId = 'agente-"ação"';
    const fetcher = vi.fn(async (_url, init) => {
      expect(init.headers.Authorization).toBe("Bearer hub");
      const body = JSON.parse(init.body);
      expect(body.agentId).toBe(agentId);
      expect(body.command.params.action_id).toBe('a"\\ção');
      expect(body.command.params.client_token).toBe("agent");
      expect(body.timeoutMs).toBe(30000);
      expect(init.redirect).toBe("error");
      return new Response(
        JSON.stringify({
          agentId,
          response: {
            type: "single",
            item: {
              id: body.command.id,
              success: true,
              result: {
                found: false,
                execution_id: null,
                reason: "not_found_in_retention_window",
              },
            },
          },
        }),
      );
    });
    const transport = createRestActionIoTransport({
      endpoint: "http://fixture.invalid",
      agentId,
      bearerToken: () => "hub",
      fetch: fetcher as typeof fetch,
    });
    await expect(
      callActionIo(
        transport,
        "findExecution",
        { action_id: 'a"\\ção', idempotency_key: "k" },
        "agent",
      ),
    ).resolves.toMatchObject({ found: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
