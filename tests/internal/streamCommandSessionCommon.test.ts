import { describe, expect, it } from "vitest";

import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  assertSocketBufferWithinLimits,
  countRows,
  resolveSocketBufferLimits,
  tryMergeChunkRowsIntoRawRpcResponse,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/streamCommandSessionCommon";

describe("streamCommandSessionCommon", () => {
  it("resolves default socket buffer limits", () => {
    expect(resolveSocketBufferLimits()).toMatchObject({
      maxBufferedChunkItems: 512,
      maxBufferedRows: 50_000,
      maxBufferedBytes: 8 * 1024 * 1024,
    });
  });

  it("throws when buffered rows exceed the limit", () => {
    const limits = resolveSocketBufferLimits({ maxBufferedRows: 1 });

    expect(() =>
      assertSocketBufferWithinLimits(limits, {
        bufferedBytes: 0,
        bufferedRows: 2,
        chunkCount: 0,
      }),
    ).toThrow(PlugError);
  });

  it("merges chunk rows into an in-flight RPC response", () => {
    const merged = tryMergeChunkRowsIntoRawRpcResponse(
      {
        jsonrpc: "2.0",
        id: "1",
        result: { rows: [{ id: 1 }], stream_id: "stream-1" },
      },
      { rows: [{ id: 2 }] },
    );

    expect(merged).toMatchObject({
      result: {
        rows: [{ id: 1 }, { id: 2 }],
        stream_id: "stream-1",
      },
    });
    expect(countRows([{ id: 1 }, { id: 2 }])).toBe(2);
  });
});
