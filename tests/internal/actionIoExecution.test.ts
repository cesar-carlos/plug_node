import { describe, expect, it, vi } from "vitest";
import { Readable } from "node:stream";
import { executeActionIoNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/actionIoExecution";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";
import login from "../fixtures/plug/login.success.json";

const setup = (parameters: Record<string, unknown>, count = 1) =>
  createMockExecuteContext({
    credentials: {
      user: "hub@example.test",
      password: "hub-only",
      baseUrl: "http://fixture.invalid/api/v1",
      agentId: "agent",
      clientToken: "local-only",
    },
    responses: [{ statusCode: 200, body: login }],
    parameters: { actionChannel: "socket", ...parameters },
    inputData: Array.from({ length: count }, () => ({ json: {} })),
  });
describe("n8n faithful I/O", () => {
  it.each(["", "opaque-next"])(
    'returns an authorized empty catalog page for cursor "%s"',
    async (cursor) => {
      const context = setup({
        operation: "listAvailable",
        catalogCursor: cursor,
        catalogPageSize: 1,
      });
      const send = vi.fn(async (command: { id: string }) => ({
        jsonrpc: "2.0",
        id: command.id,
        result: { actions: [], next_cursor: null },
      }));
      const output = await executeActionIoNode(context, {
        supportsSocket: true,
        actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
      });
      expect(output[0][0].json).toEqual({ actions: [], next_cursor: null });
      expect(send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          method: "agent.action.listAvailable",
          params: {
            client_token: "local-only",
            page_size: 1,
            ...(cursor ? { cursor } : {}),
          },
        }),
      );
    },
  );
  it("reuses a connection within execution, preserving input order and disposing once", async () => {
    const context = setup(
      {
        operation: "sendInput",
        actionExecutionId: "e",
        actionMessageId: ["m0", "m1"],
        actionSequence: [0, 1],
        actionBase64: ["AP8=", ""],
      },
      2,
    );
    const dispose = vi.fn();
    const send = vi.fn(async (command) => ({
      jsonrpc: "2.0",
      id: command.id,
      result: {
        execution_id: "e",
        message_id: command.params.message_id,
        sequence: command.params.sequence,
        state: "accepted",
        confirmed_bytes: 0,
        next_input_sequence: command.params.sequence + 1,
        stdin_state: "open",
      },
    }));
    const factory = vi.fn(async () => Object.assign(send, { dispose }));
    const result = await executeActionIoNode(context, {
      supportsSocket: true,
      actionIoTransportFactory: factory,
    });
    expect(result[0]).toHaveLength(2);
    expect(factory).toHaveBeenCalledOnce();
    expect(dispose).toHaveBeenCalledOnce();
    expect(send.mock.calls.map(([c]) => c.params.data_base64)).toEqual(["AP8=", ""]);
    expect(send.mock.calls[0][0].params.client_token).toBe("local-only");
    expect(JSON.stringify(send.mock.calls)).not.toContain("hub-only");
    expect(context.httpRequestMock).toHaveBeenCalledOnce();
  });
  it("rejects oversized binary streams before dispatch and destroys the reader", async () => {
    const context = setup({
      operation: "sendInput",
      actionExecutionId: "e",
      actionMessageId: "m",
      actionSequence: 0,
      actionInputFormat: "binary",
    });
    const stream = Readable.from([Buffer.alloc(65536), Buffer.alloc(1)]);
    context.helpers.assertBinaryData = vi
      .fn()
      .mockReturnValue({ id: "stored", data: "filesystem" });
    context.helpers.getBinaryStream = vi.fn().mockResolvedValue(stream);
    const factory = vi.fn();
    await expect(
      executeActionIoNode(context, {
        supportsSocket: true,
        actionIoTransportFactory: factory,
      }),
    ).rejects.toThrow("INPUT_TOO_LARGE");
    expect(factory).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
  });
  it("emits byte-identical binary events and an uncommitted next checkpoint", async () => {
    const context = setup({
      operation: "readIo",
      actionExecutionId: "e",
      actionAfterSequence: 0,
    });
    const prepare = vi
      .fn()
      .mockResolvedValue({ data: "AP8NCg==", mimeType: "application/octet-stream" });
    context.helpers.prepareBinaryData = prepare;
    const send = async (command: { id: string }) => ({
      jsonrpc: "2.0",
      id: command.id,
      result: {
        execution_id: "e",
        events: [
          {
            sequence: 1,
            type: "output",
            stream: "stdout",
            offset: 0,
            data_base64: "AP8NCg==",
          },
        ],
        next_sequence: 1,
        terminal: false,
        output_complete: false,
      },
    });
    const result = await executeActionIoNode(context, {
      supportsSocket: true,
      actionIoTransportFactory: async () => Object.assign(send, { dispose: vi.fn() }),
    });
    expect(prepare.mock.calls[0][0]).toEqual(Buffer.from([0, 255, 13, 10]));
    expect(result[0][0].json.next_offsets).toEqual({ stdout: 4, stderr: 0 });
    expect(result[0][0].binary?.event_1).toBeDefined();
  });
  it("refuses n8n automatic Retry On Fail before authentication", async () => {
    const context = setup({ operation: "cancel" });
    const node = context.getNode();
    context.getNode = () => ({ ...node, retryOnFail: true });
    await expect(executeActionIoNode(context, { supportsSocket: true })).rejects.toThrow(
      "DISABLE_NODE_RETRY",
    );
    expect(context.httpRequestMock).not.toHaveBeenCalled();
  });
});
