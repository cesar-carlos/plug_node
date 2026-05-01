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
});
