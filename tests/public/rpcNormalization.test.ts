import { describe, expect, it } from "vitest";

import type { NormalizedRpcItem } from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/api";
import { PlugError } from "../../packages/n8n-nodes-plug-client/generated/shared/contracts/errors";
import { toPlugErrorFromRpcItem } from "../../packages/n8n-nodes-plug-client/generated/shared/output/rpcNormalization";

describe("toPlugErrorFromRpcItem", () => {
  it("maps agent offline responses to a clearer user message", () => {
    const item: NormalizedRpcItem = {
      id: "rpc-1",
      success: false,
      error: {
        code: -32000,
        message: "agent_offline",
        data: {
          reason: "agent_disconnected_at_dispatch",
          category: "transport",
          retryable: false,
          correlation_id: "corr-1",
        },
      },
    };

    const error = toPlugErrorFromRpcItem(item, {
      agentId: "agent-1",
      requestId: "request-1",
    });

    expect(error).toMatchObject<Partial<PlugError>>({
      message: "The agent is offline right now.",
      code: "RPC_-32000",
      correlationId: "corr-1",
      technicalMessage: "agent_offline",
    });
    expect(error.description).toBe("Reconnect the Plug agent and run the node again.");
    expect(error.details).toMatchObject({
      reason: "agent_disconnected_at_dispatch",
      category: "transport",
    });
  });

  it("preserves user_message and adds retry guidance for rate-limited RPC errors", () => {
    const item: NormalizedRpcItem = {
      id: "rpc-2",
      success: false,
      error: {
        code: -32013,
        message: "rate_limited",
        data: {
          reason: "rate_limited",
          category: "transport",
          retryable: false,
          user_message: "Too many policy requests right now.",
          correlation_id: "corr-2",
          retry_after_ms: 1500,
        },
      },
    };

    const error = toPlugErrorFromRpcItem(item, {
      agentId: "agent-1",
      requestId: "request-2",
    });

    expect(error).toMatchObject<Partial<PlugError>>({
      message: "Too many policy requests right now.",
      code: "RPC_-32013",
      correlationId: "corr-2",
      retryAfterSeconds: 2,
      retryable: false,
      technicalMessage: "rate_limited",
    });
    expect(error.description).toBe("Wait 2 second(s) before retrying this operation.");
  });
});
