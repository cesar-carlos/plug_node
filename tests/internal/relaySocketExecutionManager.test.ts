import { beforeEach, describe, expect, it, vi } from "vitest";

const createSocketIoTransportMock = vi.fn();
const executeRelayCommandMock = vi.fn();
const executeRelayBatchCommandMock = vi.fn();

vi.mock(
  "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/socketIoTransport",
  () => ({
    createSocketIoTransport: (...args: unknown[]) => createSocketIoTransportMock(...args),
  }),
);

vi.mock(
  "../../packages/n8n-nodes-plug-database/generated/shared/socket/relaySession",
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import("../../packages/n8n-nodes-plug-database/generated/shared/socket/relaySession")
      >();
    return {
      ...actual,
      executeRelayCommand: (...args: unknown[]) => executeRelayCommandMock(...args),
    };
  },
);

vi.mock(
  "../../packages/n8n-nodes-plug-database/generated/shared/socket/relayBatchSession",
  () => ({
    executeRelayBatchCommand: (...args: unknown[]) =>
      executeRelayBatchCommandMock(...args),
  }),
);

const buildMockTransport = () => ({
  connected: false,
  connect: vi.fn(function connect(this: { connected: boolean }) {
    this.connected = true;
  }),
  disconnect: vi.fn(function disconnect(this: { connected: boolean }) {
    this.connected = false;
  }),
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  updateAccessToken: vi.fn(),
});

const relaySuccess = {
  channel: "socket" as const,
  socketMode: "relay" as const,
  agentId: "agent-1",
  requestId: "req-1",
  notification: false as const,
  conversationId: "conversation-1",
  response: {
    type: "single" as const,
    success: true,
    item: {
      id: "rpc-1",
      success: true,
      result: { rows: [] },
    },
  },
  rawResponsePayload: {},
  chunkPayloads: [],
  rawChunkFrames: [],
};

describe("RelaySocketExecutionManager", () => {
  it("should prevent queued commands and late results after execution close", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");
    const executor = createRelaySocketCommandExecutor();
    let finish!: (value: typeof relaySuccess) => void;
    executeRelayCommandMock.mockReturnValue(
      new Promise<typeof relaySuccess>((resolve) => {
        finish = resolve;
      }),
    );
    const input = {
      session: {
        credentials: {
          user: "fixture",
          password: "fixture",
          baseUrl: "https://fixture.invalid/api/v1",
        },
        accessToken: "fixture",
      },
      agentId: "agent-1",
      command: { jsonrpc: "2.0", method: "sql.execute", id: "one", params: {} },
      responseMode: "aggregatedJson" as const,
    };
    const active = executor.execute(input);
    const queued = executor.execute({
      ...input,
      command: { ...input.command, id: "two" },
    });
    const rejected = [
      expect(active).rejects.toThrow(/closed/),
      expect(queued).rejects.toThrow(/closed/),
    ];
    await vi.waitFor(() => expect(executeRelayCommandMock).toHaveBeenCalledTimes(1));
    executor.close();
    executor.close();
    finish(relaySuccess);
    await Promise.all(rejected);
    await expect(executor.execute(input)).rejects.toThrow(/closed/);
    expect(executeRelayCommandMock).toHaveBeenCalledTimes(1);
    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(1);
  });

  it("should isolate learned stream ceilings by agent and expire them without extra discovery", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");
    const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
    const executor = createRelaySocketCommandExecutor();
    executeRelayCommandMock.mockImplementation(async (input: { agentId: string }) => ({
      ...relaySuccess,
      agentId: input.agentId,
      rawResponsePayload: {
        result: { maxStreamPullWindowSize: input.agentId === "a" ? 16 : 128 },
      },
    }));
    const input = (agentId: string) => ({
      session: {
        credentials: {
          user: "fixture",
          password: "fixture",
          baseUrl: "https://fixture.invalid/api/v1",
        },
        accessToken: "fixture",
      },
      agentId,
      command: { jsonrpc: "2.0", method: "rpc.discover", id: agentId, params: {} },
      responseMode: "aggregatedJson" as const,
    });
    try {
      await executor.execute(input("a"));
      await executor.execute(input("b"));
      await executor.execute(input("a"));
      await executor.execute(input("b"));
      expect(
        executeRelayCommandMock.mock.calls[0][0].agentMaxStreamPullWindowSize,
      ).toBeUndefined();
      expect(
        executeRelayCommandMock.mock.calls[1][0].agentMaxStreamPullWindowSize,
      ).toBeUndefined();
      expect(executeRelayCommandMock.mock.calls[2][0].agentMaxStreamPullWindowSize).toBe(
        16,
      );
      expect(executeRelayCommandMock.mock.calls[3][0].agentMaxStreamPullWindowSize).toBe(
        128,
      );
      now.mockReturnValue(61_000);
      await executor.execute(input("a"));
      expect(
        executeRelayCommandMock.mock.calls[4][0].agentMaxStreamPullWindowSize,
      ).toBeUndefined();
      expect(executeRelayCommandMock).toHaveBeenCalledTimes(5);
    } finally {
      now.mockRestore();
      executor.close();
    }
  });

  beforeEach(() => {
    createSocketIoTransportMock.mockReset();
    executeRelayCommandMock.mockReset();
    executeRelayBatchCommandMock.mockReset();
    createSocketIoTransportMock.mockImplementation(() => buildMockTransport());
    executeRelayCommandMock.mockResolvedValue(relaySuccess);
    executeRelayBatchCommandMock.mockResolvedValue([
      {
        clientRequestId: "1",
        requestId: "hub-1",
        response: {
          ...relaySuccess,
          requestId: "hub-1",
        },
      },
    ]);
  });

  it("creates the socket transport only once across consecutive relay executes", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    const executor = createRelaySocketCommandExecutor();
    const input = {
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        id: 1,
        method: "sql.execute",
        params: { sql: "SELECT TOP 1 * FROM Cliente" },
      },
      responseMode: "aggregatedJson" as const,
    };

    await executor.execute(input);
    await executor.execute(input);

    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(1);
    expect(executeRelayCommandMock).toHaveBeenCalledTimes(2);
    expect(executeRelayCommandMock.mock.calls[1]?.[0]).toMatchObject({
      reusedConversationId: "conversation-1",
      skipConversationEnd: true,
      managedTransport: true,
    });
    executor.close();
  });

  it("routes command arrays through executeRelayBatchCommand", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    const executor = createRelaySocketCommandExecutor();
    const input = {
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
      agentId: "agent-1",
      command: [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "sql.execute",
          params: { sql: "SELECT 1" },
        },
      ],
      responseMode: "aggregatedJson" as const,
    };

    const result = await executor.execute(input);

    expect(executeRelayBatchCommandMock).toHaveBeenCalledTimes(1);
    expect(executeRelayCommandMock).not.toHaveBeenCalled();
    expect(result.response).toMatchObject({
      type: "batch",
      success: true,
    });
  });

  it("forwards fastPath to executeRelayBatchCommand for command arrays", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    const executor = createRelaySocketCommandExecutor();
    const input = {
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
      agentId: "agent-1",
      command: [
        {
          jsonrpc: "2.0",
          id: 1,
          method: "sql.execute",
          params: { sql: "SELECT 1" },
        },
      ],
      responseMode: "aggregatedJson" as const,
      fastPath: true as const,
    };

    await executor.execute(input);

    expect(executeRelayBatchCommandMock).toHaveBeenCalledWith(
      expect.objectContaining({ fastPath: true }),
    );
    executor.close();
  });

  it("recreates the transport when the access token changes while idle", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    const firstTransport = buildMockTransport();
    const secondTransport = buildMockTransport();
    createSocketIoTransportMock
      .mockImplementationOnce(() => firstTransport)
      .mockImplementationOnce(() => secondTransport);

    const executor = createRelaySocketCommandExecutor();
    const baseInput = {
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        id: 1,
        method: "sql.execute",
        params: { sql: "SELECT TOP 1 * FROM Cliente" },
      },
      responseMode: "aggregatedJson" as const,
    };

    await executor.execute({
      ...baseInput,
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
    });
    await executor.execute({
      ...baseInput,
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-b",
        loginResponse: {},
      },
    });

    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(2);
    expect(firstTransport.disconnect).toHaveBeenCalled();
  });

  it("marks the manager stale after executeRelayCommand fails", async () => {
    executeRelayCommandMock.mockRejectedValueOnce(new Error("relay failed"));
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    const executor = createRelaySocketCommandExecutor();
    const input = {
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        id: 1,
        method: "sql.execute",
        params: { sql: "SELECT TOP 1 * FROM Cliente" },
      },
      responseMode: "aggregatedJson" as const,
    };

    await expect(executor.execute(input)).rejects.toThrow("relay failed");
    createSocketIoTransportMock.mockClear();
    executeRelayCommandMock.mockResolvedValue(relaySuccess);
    await executor.execute(input);

    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(1);
  });

  it("marks the manager stale when terminal socket events fire", async () => {
    let disconnectHandler: (() => void) | undefined;
    createSocketIoTransportMock.mockImplementation(() => {
      const transport = buildMockTransport();
      transport.on.mockImplementation((event: string, handler: () => void) => {
        if (event === "disconnect") {
          disconnectHandler = handler;
        }
      });
      return transport;
    });

    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    const executor = createRelaySocketCommandExecutor();
    const input = {
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        id: 1,
        method: "sql.execute",
        params: { sql: "SELECT TOP 1 * FROM Cliente" },
      },
      responseMode: "aggregatedJson" as const,
    };

    await executor.execute(input);
    disconnectHandler?.();
    createSocketIoTransportMock.mockClear();
    executeRelayCommandMock.mockResolvedValue(relaySuccess);
    await executor.execute(input);

    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent executes for the same agentId", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const order: string[] = [];

    executeRelayCommandMock.mockImplementationOnce(async () => {
      order.push("first-start");
      await firstGate;
      order.push("first-end");
      return relaySuccess;
    });
    executeRelayCommandMock.mockImplementationOnce(async () => {
      order.push("second-start");
      return {
        ...relaySuccess,
        conversationId: "conversation-2",
        requestId: "req-2",
      };
    });

    const executor = createRelaySocketCommandExecutor();
    const input = {
      session: {
        credentials: {
          baseUrl: "https://plug-server.example.com/api/v1",
          user: "u",
          password: "p",
        },
        accessToken: "token-a",
        loginResponse: {},
      },
      agentId: "agent-1",
      command: {
        jsonrpc: "2.0",
        id: 1,
        method: "sql.execute",
        params: { sql: "SELECT TOP 1 * FROM Cliente" },
      },
      responseMode: "aggregatedJson" as const,
    };

    const first = executor.execute(input);
    const second = executor.execute({
      ...input,
      command: { ...input.command, id: 2 },
    });

    await vi.waitFor(() => {
      expect(order).toEqual(["first-start"]);
    });
    releaseFirst();
    await Promise.all([first, second]);
    expect(order).toEqual(["first-start", "first-end", "second-start"]);
  });
});
