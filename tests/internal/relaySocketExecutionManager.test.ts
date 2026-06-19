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

  it("recreates the transport when the access token changes", async () => {
    const { createRelaySocketCommandExecutor } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/relaySocketExecutionManager");

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
});
