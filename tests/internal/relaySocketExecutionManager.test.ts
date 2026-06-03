import { beforeEach, describe, expect, it, vi } from "vitest";

const createSocketIoTransportMock = vi.fn();
const executeRelayCommandMock = vi.fn();

vi.mock(
  "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/socketIoTransport",
  () => ({
    createSocketIoTransport: (...args: unknown[]) => createSocketIoTransportMock(...args),
  }),
);

vi.mock(
  "../../packages/n8n-nodes-plug-database/generated/shared/socket/relaySession",
  () => ({
    executeRelayCommand: (...args: unknown[]) => executeRelayCommandMock(...args),
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
    createSocketIoTransportMock.mockImplementation(() => buildMockTransport());
    executeRelayCommandMock.mockResolvedValue(relaySuccess);
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
    executor.close();

    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(1);
    expect(executeRelayCommandMock).toHaveBeenCalledTimes(2);
  });

  it("rejects command arrays before calling executeRelayCommand", async () => {
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

    await expect(executor.execute(input)).rejects.toThrow(/single JSON-RPC command/i);
    expect(executeRelayCommandMock).not.toHaveBeenCalled();
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
