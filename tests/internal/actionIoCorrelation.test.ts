import { describe, expect, it, vi } from "vitest";
import fixtures from "../fixtures/action-io-shared.json";
import { callActionIo } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import {
  captureActionIoExpectation,
  matchesActionIoExpectation,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/expectation";
import { isValidActionIoResponse } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/results";

describe("I/O request/result correlation", () => {
  const run = fixtures.cases.find((c) => c.name === "faithful terminal duplicate")!
    .payload as Record<string, unknown>;
  it("rejects a missing journal sequence at the page boundary or inside a page", () => {
    const page = (sequences: number[]) => ({
      events: sequences.map((sequence) => ({ sequence })),
      next_sequence: sequences.at(-1),
    });
    expect(matchesActionIoExpectation(page([6, 7]), { afterSequence: 5 })).toBe(true);
    expect(matchesActionIoExpectation(page([7]), { afterSequence: 5 })).toBe(false);
    expect(matchesActionIoExpectation(page([6, 8]), { afterSequence: 5 })).toBe(false);
  });
  it("requires faithful session state for execution and matching nested cancellation", () => {
    expect(isValidActionIoResponse("agent.action.run", { result: run })).toBe(true);
    expect(
      isValidActionIoResponse("agent.action.getExecution", {
        result: { ...run, io: undefined },
      }),
    ).toBe(false);
    const cancel = {
      cancelled: true,
      execution_id: run.execution_id,
      status: run.status,
      reason: "cancel_requested",
      execution: run,
    };
    expect(isValidActionIoResponse("agent.action.cancel", { result: cancel })).toBe(true);
    expect(
      isValidActionIoResponse("agent.action.cancel", {
        result: { ...cancel, execution_id: "other" },
      }),
    ).toBe(false);
    expect(
      isValidActionIoResponse("agent.action.cancel", {
        result: { ...cancel, status: "cancelled" },
      }),
    ).toBe(false);
    expect(isValidActionIoResponse(undefined, {})).toBe(false);
    expect(isValidActionIoResponse("unknown", {})).toBe(false);
    expect(isValidActionIoResponse("agent.action.run", null)).toBe(false);
  });
  it("rejects action, execution, message, sequence and confirmed-byte mismatches", () => {
    const result = {
      action_id: "a",
      execution_id: "e",
      message_id: "m",
      sequence: 2,
      state: "written",
      confirmed_bytes: 2,
    };
    const expected = {
      actionId: "a",
      executionId: "e",
      messageId: "m",
      sequence: 2,
      inputBytes: 2,
    };
    expect(matchesActionIoExpectation(result, expected)).toBe(true);
    for (const patch of [
      { action_id: "other" },
      { execution_id: "other" },
      { message_id: "other" },
      { sequence: 1 },
      { confirmed_bytes: 1 },
      { state: "writing", confirmed_bytes: 3 },
    ])
      expect(matchesActionIoExpectation({ ...result, ...patch }, expected)).toBe(false);
    expect(matchesActionIoExpectation(null, expected)).toBe(false);
  });
  it("does not advance an empty cursor and rejects stale, missing or oversized events", () => {
    const expected = { afterSequence: 2, maxBytes: 1 };
    expect(matchesActionIoExpectation({ events: [], next_sequence: 2 }, expected)).toBe(
      true,
    );
    for (const result of [
      {},
      { events: [], next_sequence: 3 },
      { events: [null] },
      { events: [{ sequence: "3" }] },
      { events: [{ sequence: 2 }] },
      { events: [{ sequence: 3, type: "output", data_base64: "AP8=" }] },
    ])
      expect(matchesActionIoExpectation(result, expected)).toBe(false);
  });
  it("captures only correlation metadata and rejects malformed replies without replay", async () => {
    expect(captureActionIoExpectation(null)).toEqual({});
    expect(captureActionIoExpectation({ method: "sql.execute", params: {} })).toEqual({});
    expect(
      captureActionIoExpectation({
        method: "agent.action.run",
        params: { action_id: "a", io: {}, client_token: "secret" },
      }),
    ).toEqual({ faithfulIo: true, actionId: "a" });
    expect(
      captureActionIoExpectation({ method: "agent.action.closeInput", params: {} })
        .inputBytes,
    ).toBe(0);
    for (const reply of [
      null,
      {},
      { jsonrpc: "1.0" },
      { error: { code: "bad" } },
      { error: { code: -1, message: 1 } },
      { error: { code: -1, message: "bad", data: "bad" } },
    ]) {
      const send = vi.fn(async (command) => ({
        jsonrpc: "2.0",
        id: command.id,
        ...reply,
      }));
      await expect(
        callActionIo(send, "cancel", { execution_id: "e" }, "token"),
      ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
      expect(send).toHaveBeenCalledOnce();
    }
  });
  it("preserves remote refusals and safe RPC codes without inferring absent effects", async () => {
    for (const data of [
      { code: "DENIED", effects_possible: false },
      { failure_code: "UNKNOWN", outcome_unknown: true },
      undefined,
    ]) {
      const send = vi.fn(async (command) => ({
        jsonrpc: "2.0",
        id: command.id,
        error: { code: -32000, message: "internal text", data },
      }));
      await expect(
        callActionIo(send, "cancel", { execution_id: "e" }, "token"),
      ).rejects.toMatchObject({
        retryable: false,
        details: { rpc_code: -32000, outcome_unknown: data?.effects_possible !== false },
      });
    }
  });
});
