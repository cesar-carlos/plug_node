import { describe, expect, it } from "vitest";

import type { NormalizedAgentRpcResponse } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { tryMergeChunkRowsIntoConsumerResponse } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandResponseMerge";
import { tryMergeChunkRowsIntoRawRpcResponse } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/streamCommandSessionCommon";

describe("stream row merge", () => {
  it("appends chunk rows in place for consumer aggregated responses", () => {
    const response = {
      type: "single",
      success: true,
      item: {
        id: "rpc-1",
        success: true,
        result: {
          rows: [{ id: 1 }],
          stream_id: "stream-1",
        },
      },
    } as NormalizedAgentRpcResponse;

    const merged = tryMergeChunkRowsIntoConsumerResponse(response, {
      rows: [{ id: 2 }, { id: 3 }],
    });

    expect(merged).toBe(response);
    expect(response.item.success && response.item.result.rows).toHaveLength(3);
  });

  it("appends many relay chunk rows without quadratic copying", () => {
    const response = {
      jsonrpc: "2.0",
      id: "1",
      result: {
        rows: [{ id: 0 }],
        stream_id: "stream-1",
      },
    };

    for (let index = 1; index <= 5_000; index += 1) {
      tryMergeChunkRowsIntoRawRpcResponse(response, {
        rows: [{ id: index }],
      });
    }

    expect(
      response.result && Array.isArray(response.result.rows)
        ? response.result.rows.length
        : 0,
    ).toBe(5_001);
  });
});
