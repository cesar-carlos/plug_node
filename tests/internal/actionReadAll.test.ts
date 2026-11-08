import { afterEach, describe, expect, it, vi } from "vitest";
import type { IExecuteFunctions, IBinaryData } from "n8n-workflow";
import { executeActionIoNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionIoExecution";
import type { ActionIoCommand } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";
import login from "../fixtures/plug/login.success.json";

const bytes = Buffer.from("ação 🌱");
const output = (sequence: number, offset: number, data: Buffer) => ({
  sequence,
  type: "output",
  stream: "stdout",
  offset,
  data_base64: data.toString("base64"),
});
const events = [
  output(1, 0, bytes.subarray(0, 8)),
  output(2, 8, bytes.subarray(8)),
  { sequence: 3, type: "process_exited", exit_code: 0 },
  { sequence: 4, type: "completed", output_complete: true },
];
const page = (items: Record<string, unknown>[], cursor = 0) => ({
  execution_id: "e",
  terminal: true,
  output_complete: true,
  events: items,
  next_sequence: items.at(-1)?.sequence ?? cursor,
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const setup = (
  channel: string,
  parameters: Record<string, unknown> = {},
  handler: (command: ActionIoCommand) => Promise<Record<string, unknown>> = async (c) => {
    const next = Number(c.params.after_sequence);
    return page(events.slice(next, next + 1));
  },
) => {
  const context = createMockExecuteContext({
    credentials: {
      user: "fixture@example.test",
      password: "secret",
      agentId: "agent",
      clientToken: "token",
    },
    parameters: {
      operation: "readAll",
      actionChannel: channel,
      actionExecutionId: "e",
      ...parameters,
    },
    responses: [{ statusCode: 200, body: login }],
  });
  const saved: Buffer[] = [];
  context.helpers.prepareBinaryData = vi.fn(async (data): Promise<IBinaryData> => {
    if (!Buffer.isBuffer(data)) throw Error("Expected bounded block");
    saved.push(Buffer.from(data));
    return {
      id: `filesystem-v2:${saved.length}`,
      data: "filesystem-v2",
      mimeType: "application/octet-stream",
    };
  });
  const dispose = vi.fn();
  const send = vi.fn(async (command: ActionIoCommand) => ({
    jsonrpc: "2.0",
    id: command.id,
    result: await handler(command),
  }));
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
  const run = () =>
    executeActionIoNode(context, {
      supportsSocket: true,
      actionIoTransportFactory: async () => Object.assign(send, { dispose }),
    });
  return { context, saved, send, dispose, run };
};

describe.each(["rest", "socket", "relay"])("%s Action I/O output draining", (channel) => {
  it.each(["cancelled", "time_limit"])(
    "preserves the first %s interruption while storage finishes",
    async (first) => {
      vi.useFakeTimers();
      const abort = new AbortController();
      const test = setup(channel, { actionReadTimeout: 10 }, async () => page(events));
      test.context.getExecutionCancelSignal = () => abort.signal;
      const original = test.context.helpers.prepareBinaryData;
      test.context.helpers.prepareBinaryData = vi.fn(async (...args) => {
        if (first === "cancelled") abort.abort();
        await vi.advanceTimersByTimeAsync(11);
        if (first === "time_limit") abort.abort();
        return original(...args);
      });
      const [[item]] = await test.run();
      expect(item.json).toMatchObject({
        stop_reason: first,
        next_sequence: 1,
        next_offsets: { stdout: 8, stderr: 0 },
        bytes_read: 8,
        output_drained: false,
      });
      expect(test.saved).toHaveLength(1);
      expect(test.send).toHaveBeenCalledOnce();
    },
  );
  it.each(["offset", "sequence", "next_sequence", "after_completed"])(
    "rejects a late %s defect before storing any part of the page",
    async (defect) => {
      const items = [output(1, 0, bytes), output(2, bytes.length, bytes)];
      const result = page(items);
      if (defect === "offset") items[1].offset++;
      if (defect === "sequence") items[1].sequence++;
      if (defect === "next_sequence") result.next_sequence = 99;
      if (defect === "after_completed")
        result.events = [
          items[0],
          { sequence: 2, type: "completed", output_complete: true },
          output(3, bytes.length, bytes),
        ];
      const test = setup(channel, {}, async () => result);
      const [[item]] = await test.run();
      expect(item.json).toMatchObject({
        stop_reason: "read_failed",
        next_sequence: 0,
        next_offsets: { stdout: 0, stderr: 0 },
        bytes_read: 0,
      });
      expect(test.saved).toHaveLength(0);
      expect(test.context.helpers.prepareBinaryData).not.toHaveBeenCalled();
    },
  );
  it("keeps only references while draining 8 MiB with bounded storage writes", async () => {
    const block = Buffer.alloc(65536, 65);
    const test = setup(channel, {}, async (c) => {
      const seq = Number(c.params.after_sequence);
      return page([
        seq < 128
          ? output(seq + 1, seq * block.length, block)
          : { sequence: 129, type: "completed", output_complete: true },
      ]);
    });
    let count = 0;
    test.context.helpers.prepareBinaryData = async (data) => {
      expect(Buffer.isBuffer(data) && data.length <= 65536).toBe(true);
      count++;
      return {
        id: `filesystem-v2:${count}`,
        data: "filesystem-v2",
        mimeType: "application/octet-stream",
      };
    };
    const [[item]] = await test.run();
    expect(count).toBe(128);
    expect(item.json).toMatchObject({ output_drained: true, bytes_read: 8388608 });
    expect(JSON.stringify(item).length).toBeLessThan(50000);
  });
  it("preserves stored chunks on a later storage failure", async () => {
    const test = setup(channel);
    const prepare = test.context.helpers.prepareBinaryData;
    let count = 0;
    test.context.helpers.prepareBinaryData = async (...args) => {
      if (++count === 2) throw Error("storage unavailable");
      return prepare(...args);
    };
    const [[item]] = await test.run();
    expect(item.json).toMatchObject({
      stop_reason: "read_failed",
      next_sequence: 1,
      bytes_read: 8,
    });
    expect(Object.keys(item.binary ?? {})).toEqual(["event_1"]);
  });
  it("rejects a gap without committing the invalid page", async () => {
    const test = setup(channel, {}, async () => page([output(2, 0, bytes)]));
    const [[item]] = await test.run();
    expect(item.json).toMatchObject({
      stop_reason: "read_failed",
      next_sequence: 0,
      bytes_read: 0,
    });
  });
  it("adds output_drained without changing page flags or legacy binary chunks", async () => {
    const first = setup(channel, { operation: "readIo" });
    const [[item]] = await first.run();
    expect(item.json).toMatchObject({
      terminal: true,
      output_complete: true,
      output_drained: false,
      next_sequence: 1,
    });
    expect(item.binary?.event_1).toBeDefined();
    const last = setup(channel, {
      operation: "readIo",
      actionAfterSequence: 3,
      actionStdoutOffset: 11,
    });
    expect((await last.run())[0][0].json).toMatchObject({ output_drained: true });
  });
  it("drains finished captures through a separate completion page and preserves UTF-8 bytes", async () => {
    const test = setup(channel);
    const [[item]] = await test.run();
    expect(item.json).toMatchObject({
      output_drained: true,
      output_complete: true,
      stop_reason: "completed",
      next_sequence: 4,
      next_offsets: { stdout: 11, stderr: 0 },
      process_exit_code: 0,
      pages_read: 4,
    });
    expect(Buffer.concat(test.saved)).toEqual(bytes);
    expect(JSON.stringify(item)).not.toContain(events[0].data_base64);
    expect(test.send.mock.calls.map(([c]) => c.method)).toEqual(
      Array(4).fill("agent.action.readIo"),
    );
  });
  it("returns byte-limited partial data and resumes at the saved checkpoint without replay", async () => {
    const test = setup(channel, { actionTotalBytes: 8 });
    const [[partial]] = await test.run();
    expect(partial.json).toMatchObject({
      stop_reason: "byte_limit",
      output_drained: false,
      next_sequence: 1,
      bytes_read: 8,
    });
    const resumed = setup(channel, {
      actionAfterSequence: partial.json.next_sequence,
      actionStdoutOffset: 8,
    });
    const [[done]] = await resumed.run();
    expect(done.json.output_drained).toBe(true);
    expect(Buffer.concat([...test.saved, ...resumed.saved])).toEqual(bytes);
  });
  it("returns recoverable partial data after a real adapter rejection", async () => {
    const test = setup(channel, {}, async (c) => {
      if (c.params.after_sequence !== 0) throw Error("disconnected");
      return page([events[0]]);
    });
    const [[item]] = await test.run();
    expect(item.json).toMatchObject({
      stop_reason: "read_failed",
      next_sequence: 1,
      next_offsets: { stdout: 8, stderr: 0 },
      output_drained: false,
    });
    expect(item.binary?.event_1).toBeDefined();
    expect(test.send).toHaveBeenCalledTimes(2);
  });
  it("consumes failed completion without polling forever or reporting complete output", async () => {
    const test = setup(channel, {}, async () => ({
      ...page([{ sequence: 1, type: "completed", output_complete: false }]),
      output_complete: false,
    }));
    expect((await test.run())[0][0].json).toMatchObject({
      output_drained: true,
      output_complete: false,
      stop_reason: "capture_failed",
    });
    expect(test.send).toHaveBeenCalledOnce();
  });
  it("rejects terminal empty pages missing completion", async () => {
    const test = setup(channel, {}, async (c) =>
      page([], Number(c.params.after_sequence)),
    );
    expect((await test.run())[0][0].json).toMatchObject({
      output_drained: false,
      error: { code: "COMPLETION_NOT_RECEIVED" },
    });
  });
  it("does not advance the checkpoint when binary storage fails or is inline", async () => {
    const test = setup(channel);
    contextInline(test.context);
    expect((await test.run())[0][0].json).toMatchObject({
      next_sequence: 0,
      bytes_read: 0,
      error: { code: "EXTERNAL_BINARY_STORAGE_REQUIRED" },
    });
  });
  it.each([
    { actionTotalBytes: 0 },
    { actionReadTimeout: 300001 },
    { actionAfterSequence: -1 },
    { actionStdoutOffset: -1 },
  ])("validates budgets and checkpoints before a read: %j", async (params) => {
    const test = setup(channel, params);
    await expect(test.run()).rejects.toThrow();
    expect(test.send).not.toHaveBeenCalled();
  });
  it("interrupts an in-flight read on cancellation without cancelling the remote process", async () => {
    const abort = new AbortController();
    const test = setup(channel, {}, async () => {
      queueMicrotask(() => abort.abort());
      return new Promise(() => {});
    });
    test.context.getExecutionCancelSignal = () => abort.signal;
    expect((await test.run())[0][0].json).toMatchObject({
      stop_reason: "cancelled",
      next_sequence: 0,
    });
    expect(test.send).toHaveBeenCalledOnce();
    if (channel !== "rest") expect(test.dispose).toHaveBeenCalled();
  });
  it("bounds waiting time without retrying the read", async () => {
    const test = setup(
      channel,
      { actionReadTimeout: 10 },
      async () => new Promise(() => {}),
    );
    expect((await test.run())[0][0].json).toMatchObject({
      stop_reason: "time_limit",
      next_sequence: 0,
    });
    expect(test.send).toHaveBeenCalledOnce();
  });
});

function contextInline(context: IExecuteFunctions): void {
  context.helpers.prepareBinaryData = vi.fn(async (data) => ({
    data: (data as Buffer).toString("base64"),
    mimeType: "application/octet-stream",
  }));
}
