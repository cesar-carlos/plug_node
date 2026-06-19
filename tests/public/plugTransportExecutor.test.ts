import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  BuiltCommandRequest,
  PlugCredentialDefaults,
  PlugSession,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import { executeBuiltCommandWithRetry } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugTransportExecutor";

const executeRestCommand = vi.hoisted(() => vi.fn());
const sleepMs = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../packages/n8n-nodes-plug-database/generated/shared/rest/client", () => ({
  executeRestCommand,
}));

vi.mock(
  "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugTransientRetry",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugTransientRetry")
      >();
    return {
      ...actual,
      sleepMs,
    };
  },
);

const session: PlugSession<PlugCredentialDefaults> = {
  credentials: {
    user: "owner@example.com",
    password: "secret",
    baseUrl: "https://plug-server.example.com/api/v1",
  },
  accessToken: "access-1",
  refreshToken: "refresh-1",
};

const sessionRunner = async <T>(
  runner: (activeSession: PlugSession<PlugCredentialDefaults>) => Promise<T>,
): Promise<T> => runner(session);

const baseRestRequest = (): BuiltCommandRequest => ({
  operation: "executeSql",
  agentId: "agent-1",
  channel: "rest",
  responseMode: "aggregatedJson",
  command: {
    jsonrpc: "2.0",
    method: "sql.execute",
    id: "cmd-1",
    params: {
      idempotency_key: "workflow-key",
      sql: "SELECT 1",
    },
  },
});

const restTransportResult = () => ({
  channel: "rest" as const,
  agentId: "agent-1",
  requestId: "req-1",
  notification: false as const,
  response: {
    type: "single" as const,
    success: true,
    item: {
      id: "rpc-1",
      success: true,
      result: { rows: [] },
    },
  },
  raw: {},
});

describe("executeBuiltCommandWithRetry", () => {
  beforeEach(() => {
    executeRestCommand.mockReset();
    sleepMs.mockClear();
  });

  it("routes REST commands through executeRestCommand", async () => {
    executeRestCommand.mockResolvedValue(restTransportResult());

    const builtRequest = baseRestRequest();
    const requester = vi.fn();
    const result = await executeBuiltCommandWithRetry({
      builtRequest,
      requester,
      sessionRunner,
      config: { supportsSocket: false },
      includeMetadata: false,
    });

    expect(executeRestCommand).toHaveBeenCalledWith(requester, session, builtRequest);
    expect(result.transportResult.channel).toBe("rest");
    expect(result.attemptCount).toBe(1);
    expect(result.jsonItems.length).toBeGreaterThan(0);
  });

  it("routes socket commands through the configured socket executor", async () => {
    const socketExecutor = vi.fn().mockResolvedValue({
      ...restTransportResult(),
      channel: "socket",
      socketMode: "agentsCommand",
      rawResponsePayload: {},
      chunkPayloads: [],
      rawChunkFrames: [],
    });
    const builtRequest: BuiltCommandRequest = {
      ...baseRestRequest(),
      channel: "socket",
      socketImplementation: "agentsCommand",
    };

    const result = await executeBuiltCommandWithRetry({
      builtRequest,
      requester: vi.fn(),
      sessionRunner,
      config: {
        supportsSocket: true,
        socketExecutor,
      },
      includeMetadata: false,
    });

    expect(executeRestCommand).not.toHaveBeenCalled();
    expect(socketExecutor).toHaveBeenCalledWith(
      expect.objectContaining({
        session,
        agentId: "agent-1",
        command: builtRequest.command,
      }),
    );
    expect(result.transportResult.channel).toBe("socket");
  });

  it("retries transient REST failures and rotates command ids between attempts", async () => {
    executeRestCommand
      .mockRejectedValueOnce(
        new PlugError("rate limited", {
          code: "RATE_LIMITED",
          statusCode: 429,
          retryable: true,
          retryAfterSeconds: 0,
        }),
      )
      .mockResolvedValueOnce(restTransportResult());

    const builtRequest = baseRestRequest();
    const result = await executeBuiltCommandWithRetry({
      builtRequest,
      requester: vi.fn(),
      sessionRunner,
      config: { supportsSocket: false },
      includeMetadata: false,
    });

    expect(executeRestCommand).toHaveBeenCalledTimes(2);
    expect(sleepMs).toHaveBeenCalledTimes(1);
    expect(result.attemptCount).toBe(2);
    expect(result.lastRetryDelayMs).toBeTypeOf("number");

    const firstCommand = executeRestCommand.mock.calls[0]?.[2]?.command;
    const secondCommand = executeRestCommand.mock.calls[1]?.[2]?.command;
    expect(firstCommand).not.toEqual(secondCommand);
  });

  it("does not retry replay_detected errors", async () => {
    const replayError = new PlugError("replay detected", {
      code: "RPC_-32014",
      retryable: false,
      details: { reason: "replay_detected" },
    });
    executeRestCommand.mockRejectedValue(replayError);

    await expect(
      executeBuiltCommandWithRetry({
        builtRequest: baseRestRequest(),
        requester: vi.fn(),
        sessionRunner,
        config: { supportsSocket: false },
        includeMetadata: false,
      }),
    ).rejects.toBe(replayError);

    expect(executeRestCommand).toHaveBeenCalledTimes(1);
    expect(sleepMs).not.toHaveBeenCalled();
  });
});
