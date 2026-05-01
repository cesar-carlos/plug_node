import { describe, expect, it } from "vitest";

import { buildNodeOutputItems } from "../../packages/n8n-nodes-plug-client/generated/shared/output/nodeOutput";
import type { PlugCommandTransportResult } from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";

describe("buildNodeOutputItems", () => {
  it("returns one item per SQL row for aggregated JSON output", () => {
    const result: PlugCommandTransportResult = {
      channel: "rest",
      agentId: "agent-1",
      requestId: "request-1",
      notification: false,
      response: {
        type: "single",
        success: true,
        item: {
          id: "rpc-1",
          success: true,
          result: {
            rows: [
              { id: 1, name: "Alpha" },
              { id: 2, name: "Beta" },
            ],
          },
        },
      },
      raw: {
        mode: "bridge",
        agentId: "agent-1",
        requestId: "request-1",
        response: {
          type: "single",
          success: true,
          item: {
            id: "rpc-1",
            success: true,
            result: {
              rows: [
                { id: 1, name: "Alpha" },
                { id: 2, name: "Beta" },
              ],
            },
          },
        },
      },
    };

    const items = buildNodeOutputItems(result, "aggregatedJson");

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: 1,
      name: "Alpha",
    });
    expect(items[1]).toMatchObject({
      id: 2,
      name: "Beta",
    });
  });

  it("can omit __plug metadata when requested", () => {
    const result: PlugCommandTransportResult = {
      channel: "rest",
      agentId: "agent-1",
      requestId: "request-1",
      notification: false,
      response: {
        type: "single",
        success: true,
        item: {
          id: "rpc-1",
          success: true,
          result: {
            rows: [{ id: 1, name: "Alpha" }],
          },
        },
      },
      raw: {
        mode: "bridge",
        agentId: "agent-1",
        requestId: "request-1",
        response: {
          type: "single",
          success: true,
          item: {
            id: "rpc-1",
            success: true,
            result: {
              rows: [{ id: 1, name: "Alpha" }],
            },
          },
        },
      },
    };

    const items = buildNodeOutputItems(result, "aggregatedJson", false);

    expect(items).toEqual([{ id: 1, name: "Alpha" }]);
  });

  it("returns one item per socket chunk in chunkItems mode", () => {
    const result: PlugCommandTransportResult = {
      channel: "socket",
      agentId: "agent-1",
      requestId: "request-1",
      notification: false,
      conversationId: "conversation-1",
      accepted: {
        success: true,
        conversationId: "conversation-1",
        requestId: "request-1",
      },
      connectionReady: {
        id: "connection-1",
        message: "ready",
        user: {
          id: "client-1",
        },
      },
      response: {
        type: "single",
        success: true,
        item: {
          id: "rpc-1",
          success: true,
          result: {
            stream_id: "stream-1",
            rows: [{ id: 1, name: "Alpha" }],
          },
        },
      },
      rawResponsePayload: {
        stream_id: "stream-1",
      },
      chunkPayloads: [
        {
          rows: [{ id: 2, name: "Beta" }],
        },
        {
          rows: [{ id: 3, name: "Gamma" }],
        },
      ],
      completePayload: {
        terminal_status: "completed",
      },
      rawResponseFrame: {
        schemaVersion: "1.0",
        enc: "json",
        cmp: "none",
        signed: false,
        payload: {
          event: "relay:rpc.response",
        },
      },
      rawChunkFrames: [
        {
          schemaVersion: "1.0",
          enc: "json",
          cmp: "none",
          signed: false,
          payload: {
            event: "relay:rpc.chunk",
          },
        },
        {
          schemaVersion: "1.0",
          enc: "json",
          cmp: "none",
          signed: false,
          payload: {
            event: "relay:rpc.chunk",
          },
        },
      ],
      rawCompleteFrame: {
        schemaVersion: "1.0",
        enc: "json",
        cmp: "none",
        signed: false,
        payload: {
          event: "relay:rpc.complete",
        },
      },
    };

    const items = buildNodeOutputItems(result, "chunkItems");

    expect(items).toEqual([
      {
        __plug: {
          channel: "socket",
          agentId: "agent-1",
          requestId: "request-1",
          conversationId: "conversation-1",
          chunkIndex: 0,
        },
        chunk: {
          rows: [{ id: 2, name: "Beta" }],
        },
      },
      {
        __plug: {
          channel: "socket",
          agentId: "agent-1",
          requestId: "request-1",
          conversationId: "conversation-1",
          chunkIndex: 1,
        },
        chunk: {
          rows: [{ id: 3, name: "Gamma" }],
        },
      },
    ]);
  });

  it("can omit metadata from socket chunkItems output", () => {
    const result: PlugCommandTransportResult = {
      channel: "socket",
      agentId: "agent-1",
      requestId: "request-1",
      notification: false,
      conversationId: "conversation-1",
      accepted: {
        success: true,
        conversationId: "conversation-1",
        requestId: "request-1",
      },
      connectionReady: {
        id: "connection-1",
        message: "ready",
        user: {
          id: "client-1",
        },
      },
      response: {
        type: "single",
        success: true,
        item: {
          id: "rpc-1",
          success: true,
          result: {
            stream_id: "stream-1",
            rows: [],
          },
        },
      },
      rawResponsePayload: {
        stream_id: "stream-1",
      },
      chunkPayloads: [
        {
          rows: [{ id: 2, name: "Beta" }],
        },
      ],
      completePayload: {
        terminal_status: "completed",
      },
      rawResponseFrame: {
        schemaVersion: "1.0",
        enc: "json",
        cmp: "none",
        signed: false,
        payload: {
          event: "relay:rpc.response",
        },
      },
      rawChunkFrames: [
        {
          schemaVersion: "1.0",
          enc: "json",
          cmp: "none",
          signed: false,
          payload: {
            event: "relay:rpc.chunk",
          },
        },
      ],
      rawCompleteFrame: {
        schemaVersion: "1.0",
        enc: "json",
        cmp: "none",
        signed: false,
        payload: {
          event: "relay:rpc.complete",
        },
      },
    };

    const items = buildNodeOutputItems(result, "chunkItems", false);

    expect(items).toEqual([
      {
        chunk: {
          rows: [{ id: 2, name: "Beta" }],
        },
      },
    ]);
  });
});
