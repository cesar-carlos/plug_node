import { describe, expect, it } from "vitest";

import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import {
  decodeConsumerCommandWirePayload,
  isConsumerNotificationResponse,
  normalizeConsumerCommandResponse,
  normalizeConsumerStreamChunkPayload,
  normalizeConsumerStreamCompletePayload,
  normalizeConsumerStreamPullResponse,
  resolveConsumerCommandRequestId,
  toConsumerCommandRequestId,
  withConsumerCommandRequestId,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandWire";

describe("consumerCommandWire helpers", () => {
  it("decodeConsumerCommandWirePayload returns plain objects and PayloadFrame data", async () => {
    await expect(decodeConsumerCommandWirePayload({ ok: true })).resolves.toEqual({
      ok: true,
    });

    const frame = encodePayloadFrame(
      { rows: [{ id: 1 }] },
      { requestId: "wire-1", compression: "none" },
    );
    await expect(decodeConsumerCommandWirePayload(frame)).resolves.toEqual({
      rows: [{ id: 1 }],
    });
  });

  it("normalizeConsumerCommandResponse validates success and failure envelopes", () => {
    expect(
      normalizeConsumerCommandResponse({
        success: true,
        requestId: "req-1",
        response: { jsonrpc: "2.0", id: "req-1", result: { ok: true } },
      }),
    ).toMatchObject({ success: true, requestId: "req-1" });

    expect(() =>
      normalizeConsumerCommandResponse({
        success: true,
        response: { ok: true },
      }),
    ).toThrow(/requestId/i);

    expect(() =>
      normalizeConsumerCommandResponse({
        success: false,
        error: { code: "X" },
      }),
    ).toThrow(/error\.code and error\.message/i);
  });

  it("normalize stream chunk/complete/pull_response payloads", () => {
    expect(normalizeConsumerStreamChunkPayload({ stream_id: "s1", rows: [] })).toMatchObject({
      stream_id: "s1",
    });
    expect(() => normalizeConsumerStreamChunkPayload({ stream_id: " " })).toThrow(
      /stream_id/i,
    );

    expect(
      normalizeConsumerStreamCompletePayload({
        stream_id: "s1",
        terminal_status: "completed",
      }),
    ).toMatchObject({ terminal_status: "completed" });
    expect(() =>
      normalizeConsumerStreamCompletePayload({ terminal_status: 1 }),
    ).toThrow(/terminal_status/i);

    expect(
      normalizeConsumerStreamPullResponse({
        success: true,
        requestId: "req-1",
        streamId: "stream-1",
        windowSize: 8,
      }),
    ).toMatchObject({ windowSize: 8 });
    expect(() =>
      normalizeConsumerStreamPullResponse({
        success: true,
        requestId: "req-1",
        streamId: "stream-1",
        windowSize: 0,
      }),
    ).toThrow(/windowSize/i);
  });

  it("to/with/resolve request ids cover string, number, and batch paths", () => {
    expect(toConsumerCommandRequestId("req-1")).toBe("req-1");
    expect(toConsumerCommandRequestId(42)).toBe("42");
    expect(toConsumerCommandRequestId("")).toBeUndefined();

    expect(
      withConsumerCommandRequestId(
        { jsonrpc: "2.0", method: "sql.execute", params: {} },
        "stamped-1",
      ),
    ).toMatchObject({ id: "stamped-1" });
    expect(
      withConsumerCommandRequestId(
        { jsonrpc: "2.0", id: "kept", method: "sql.execute", params: {} },
        "stamped-1",
      ),
    ).toMatchObject({ id: "kept" });

    const batchId = resolveConsumerCommandRequestId([
      { jsonrpc: "2.0", id: "a", method: "sql.execute", params: {} },
      { jsonrpc: "2.0", id: "b", method: "sql.execute", params: {} },
    ]);
    expect(typeof batchId).toBe("string");
    expect(batchId.length).toBeGreaterThan(0);

    expect(
      resolveConsumerCommandRequestId({
        jsonrpc: "2.0",
        id: "kept-id",
        method: "sql.execute",
        params: {},
      }),
    ).toBe("kept-id");
  });

  it("detects consumer notification responses", () => {
    expect(
      isConsumerNotificationResponse({
        type: "notification",
        accepted: true,
        acceptedCommands: 2,
      }),
    ).toBe(true);
    expect(isConsumerNotificationResponse({ type: "notification" })).toBe(false);
  });
});
