import { describe, expect, it } from "vitest";

import type { RpcSingleCommand } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import {
  executeRelayBatchCommand,
  MAX_RELAY_BATCH_COMMANDS,
  type RelaySocketTransport,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/relayBatchSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";

class MockRelayBatchTransport implements RelaySocketTransport {
  connected = false;

  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  connect(): void {
    this.connected = true;
  }

  disconnect(): void {
    this.connected = false;
  }

  on(event: string, handler: (payload: unknown) => void): void {
    const eventHandlers = this.handlers.get(event) ?? new Set();
    eventHandlers.add(handler);
    this.handlers.set(event, eventHandlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });

    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-batch",
          agentId: "agent-1",
        });
      });
      return;
    }

    if (event === "relay:rpc.request.batch") {
      queueMicrotask(() => {
        this.dispatch("relay:rpc.batch_accepted", {
          success: true,
          conversationId: "conversation-batch",
          batchSize: 2,
          items: [
            {
              clientRequestId: "client-1",
              requestId: "hub-1",
            },
            {
              clientRequestId: "client-2",
              requestId: "hub-2",
            },
          ],
        });

        setTimeout(() => {
          for (const item of [
            {
              clientRequestId: "client-1",
              requestId: "hub-1",
              result: { rows: [{ id: 1 }] },
            },
            {
              clientRequestId: "client-2",
              requestId: "hub-2",
              result: { rows: [{ id: 2 }] },
            },
          ]) {
            this.dispatch(
              "relay:rpc.response",
              encodePayloadFrame(
                {
                  jsonrpc: "2.0",
                  id: item.clientRequestId,
                  result: item.result,
                },
                { requestId: item.requestId, compression: "none" },
              ),
            );
          }
        }, 0);
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

const buildCommand = (id: string): RpcSingleCommand => ({
  jsonrpc: "2.0",
  id,
  method: "sql.execute",
  params: {
    sql: `SELECT ${id}`,
    client_token: "token",
  },
});

describe("executeRelayBatchCommand", () => {
  it("accepts batch envelopes and resolves per-item responses", async () => {
    const transport = new MockRelayBatchTransport();
    transport.connect();

    const results = await executeRelayBatchCommand({
      transport,
      session: {
        credentials: {
          user: "u",
          password: "p",
          baseUrl: "https://example.com/api/v1",
        },
        accessToken: "token",
        refreshToken: "refresh",
        loginResponse: {
          accessToken: "token",
          refreshToken: "refresh",
          client: {
            id: "client-1",
            userId: "user-1",
            email: "u@example.com",
            name: "User",
            lastName: "One",
            status: "active",
            role: "client",
          },
        },
      },
      agentId: "agent-1",
      commands: [buildCommand("client-1"), buildCommand("client-2")],
      responseMode: "aggregatedJson",
      managedTransport: true,
      skipConversationEnd: true,
    });

    expect(results).toHaveLength(2);
    expect(results[0]?.requestId).toBe("hub-1");
    expect(results[1]?.requestId).toBe("hub-2");
    expect(
      transport.emittedEvents.some((entry) => entry.event === "relay:rpc.request.batch"),
    ).toBe(true);
  });

  it("rejects batches above the hub limit", async () => {
    const transport = new MockRelayBatchTransport();
    const commands = Array.from({ length: MAX_RELAY_BATCH_COMMANDS + 1 }, (_, index) =>
      buildCommand(`client-${index}`),
    );

    await expect(
      executeRelayBatchCommand({
        transport,
        session: {
          credentials: {
            user: "u",
            password: "p",
            baseUrl: "https://example.com/api/v1",
          },
          accessToken: "token",
          refreshToken: "refresh",
          loginResponse: {
            accessToken: "token",
            refreshToken: "refresh",
            client: {
              id: "client-1",
              userId: "user-1",
              email: "u@example.com",
              name: "User",
              lastName: "One",
              status: "active",
              role: "client",
            },
          },
        },
        agentId: "agent-1",
        commands,
        responseMode: "aggregatedJson",
      }),
    ).rejects.toThrow(/at most 32/i);
  });
});
