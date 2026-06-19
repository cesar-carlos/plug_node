import { describe, expect, it } from "vitest";

import type { NormalizedRpcItem } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import {
  PlugError,
  PlugValidationError,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  ensureSuccessfulNormalizedResponse,
  normalizeRpcPayload,
  toPlugErrorFromRpcItem,
} from "../../packages/n8n-nodes-plug-database/generated/shared/output/rpcNormalization";

const context = {
  agentId: "agent-1",
  requestId: "request-1",
};

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

    const error = toPlugErrorFromRpcItem(item, context);

    expect(error).toMatchObject<Partial<PlugError>>({
      message: "The agent is offline right now.",
      code: "RPC_-32000",
      correlationId: "corr-1",
      technicalMessage: "agent_offline",
    });
    expect(error.description).toBe("Reconnect the Plug agent and run the node again.");
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

  it("maps replay_detected responses to a clearer user message", () => {
    const item: NormalizedRpcItem = {
      id: "rpc-3",
      success: false,
      error: {
        code: -32014,
        message: "Replay detected",
        data: {
          reason: "replay_detected",
          category: "transport",
          retryable: false,
          correlation_id: "corr-3",
        },
      },
    };

    const error = toPlugErrorFromRpcItem(item, {
      agentId: "agent-1",
      requestId: "request-3",
    });

    expect(error.message).toBe("This command was already sent recently.");
    expect(error.description).toBe(
      "Use a new JSON-RPC id for each intentional retry within about two minutes.",
    );
  });

  it("maps missing_client_token to credential guidance", () => {
    const error = toPlugErrorFromRpcItem(
      {
        id: "rpc-4",
        success: false,
        error: {
          code: -32001,
          message: "missing_client_token",
          data: {
            reason: "missing_client_token",
            category: "auth",
          },
        },
      },
      context,
    );

    expect(error.message).toBe("The Client Token was not accepted by the agent.");
    expect(error.description).toContain("Client Token");
  });

  it("throws when the RPC item has no error payload", () => {
    expect(() =>
      toPlugErrorFromRpcItem(
        {
          id: "rpc-5",
          success: true,
          result: { ok: true },
        },
        context,
      ),
    ).toThrow(PlugValidationError);
  });
});

describe("normalizeRpcPayload", () => {
  it("normalizes batch responses and marks partial failures as unsuccessful", () => {
    const response = normalizeRpcPayload([
      {
        jsonrpc: "2.0",
        id: "1",
        result: { rows: [] },
      },
      {
        jsonrpc: "2.0",
        id: "2",
        error: {
          code: -32602,
          message: "invalid_params",
          data: { reason: "invalid_params" },
        },
      },
    ]);

    expect(response).toMatchObject({
      type: "batch",
      success: false,
      items: [
        { id: "1", success: true },
        { id: "2", success: false },
      ],
    });
  });

  it("returns raw responses for unrecognized payloads", () => {
    expect(normalizeRpcPayload("not-json-rpc")).toEqual({
      type: "raw",
      success: false,
      payload: "not-json-rpc",
    });
  });
});

describe("ensureSuccessfulNormalizedResponse", () => {
  it("returns successful single responses unchanged", () => {
    const response = normalizeRpcPayload({
      jsonrpc: "2.0",
      id: "1",
      result: { rows: [{ id: 1 }] },
    });

    expect(ensureSuccessfulNormalizedResponse(response, context)).toEqual(response);
  });

  it("throws the first RPC error from a failed batch", () => {
    const response = normalizeRpcPayload([
      {
        jsonrpc: "2.0",
        id: "1",
        result: { rows: [] },
      },
      {
        jsonrpc: "2.0",
        id: "2",
        error: {
          code: -32001,
          message: "sql_validation_failed",
          data: { reason: "sql_validation_failed" },
        },
      },
    ]);

    expect(() => ensureSuccessfulNormalizedResponse(response, context)).toThrow(
      PlugError,
    );
  });

  it("throws when the payload cannot be normalized", () => {
    expect(() =>
      ensureSuccessfulNormalizedResponse(
        {
          type: "raw",
          success: false,
          payload: { unexpected: true },
        },
        context,
      ),
    ).toThrow(
      expect.objectContaining({
        code: "RPC_RAW_RESPONSE",
      }),
    );
  });
});
