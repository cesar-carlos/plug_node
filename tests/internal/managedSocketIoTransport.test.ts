import { beforeEach, describe, expect, it, vi } from "vitest";

const createSocketIoTransportMock = vi.fn();

vi.mock(
  "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/socketIoTransport",
  () => ({
    createSocketIoTransport: (...args: unknown[]) => createSocketIoTransportMock(...args),
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

describe("ManagedSocketIoTransport refcount", () => {
  beforeEach(() => {
    createSocketIoTransportMock.mockReset();
    createSocketIoTransportMock.mockImplementation(() => buildMockTransport());
  });

  it("defers dispose until release when commands are in flight", async () => {
    const { createManagedSocketIoTransport } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/managedSocketIoTransport");

    const managed = createManagedSocketIoTransport({
      socketMode: "agentsCommand",
      logEventKey: "refcount_test",
    });

    const transport = managed.ensureTransport(
      "https://plug-server.example.com/api/v1",
      "token-a",
    );

    managed.acquire();
    expect(managed.getActiveCount()).toBe(1);

    managed.dispose();
    expect(transport.disconnect).not.toHaveBeenCalled();
    expect(managed.stale).toBe(true);
    expect(managed.getActiveCount()).toBe(1);

    managed.release();
    expect(managed.getActiveCount()).toBe(0);
    expect(transport.disconnect).toHaveBeenCalledTimes(1);
  });

  it("keeps the live socket for ensureTransport while activeCount is positive", async () => {
    const { createManagedSocketIoTransport } =
      await import("../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/managedSocketIoTransport");

    const first = buildMockTransport();
    const second = buildMockTransport();
    createSocketIoTransportMock
      .mockImplementationOnce(() => first)
      .mockImplementationOnce(() => second);

    const managed = createManagedSocketIoTransport({
      socketMode: "agentsCommand",
      logEventKey: "refcount_reuse_test",
    });

    const transportA = managed.ensureTransport(
      "https://plug-server.example.com/api/v1",
      "token-a",
    );
    managed.acquire();
    managed.markStale();

    const transportB = managed.ensureTransport(
      "https://plug-server.example.com/api/v1",
      "token-a",
    );

    expect(transportB).toBe(transportA);
    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(1);
    expect(first.disconnect).not.toHaveBeenCalled();

    managed.release();
    expect(first.disconnect).toHaveBeenCalledTimes(1);

    const transportC = managed.ensureTransport(
      "https://plug-server.example.com/api/v1",
      "token-a",
    );
    expect(transportC).toBe(second);
    expect(createSocketIoTransportMock).toHaveBeenCalledTimes(2);
  });
});
