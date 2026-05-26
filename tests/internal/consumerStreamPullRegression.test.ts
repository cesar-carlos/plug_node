import { describe, expect, it } from "vitest";

import type {
  PlugSession,
  RelayConnectionReadyPayload,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import {
  executeConsumerCommand,
  type ConsumerSocketTransport,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/consumerCommandSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";

const session: PlugSession = {
  credentials: {
    user: "client@example.com",
    password: "secret",
    baseUrl: "https://plug-server.example.com/api/v1",
  },
  accessToken: "access-1",
  refreshToken: "refresh-1",
  loginResponse: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    client: {
      id: "client-1",
      userId: "user-1",
      email: "client@example.com",
      name: "Plug",
      lastName: "Client",
      status: "active",
      role: "client",
    },
  },
};

class StreamPullFailureTransport implements ConsumerSocketTransport {
  connected = false;
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  connect(): void {
    this.connected = true;

    queueMicrotask(() => {
      this.dispatch(
        "connection:ready",
        encodePayloadFrame(
          {
            id: "socket-1",
            message: "Consumer socket connected successfully",
            user: { sub: "client-1", role: "client" },
          } as RelayConnectionReadyPayload,
          { requestId: "handshake", compression: "none" },
        ),
      );
    });
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
    if (event === "agents:command") {
      const requestId = (payload as { readonly requestId: string }).requestId;
      queueMicrotask(() => {
        this.dispatch("agents:command_response", {
          success: true,
          requestId,
          streamId: "stream-1",
          response: {
            type: "single",
            success: true,
            item: {
              id: "rpc-1",
              success: true,
              result: {
                rows: [],
                stream_id: "stream-1",
              },
            },
          },
        });
      });
      return;
    }

    if (event === "agents:stream_pull") {
      // B-03 scenario: failure response with no requestId and no streamId.
      // Before the fix this was silently ignored, causing the command to time
      // out instead of failing fast.
      queueMicrotask(() => {
        this.dispatch("agents:stream_pull_response", {
          success: false,
          error: {
            code: "STREAM_LOST",
            message: "Stream was lost",
          },
        });
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe("B-03: matchesStreamPullResponse fail-fast for failure responses without IDs", () => {
  it("surfaces a STREAM_LOST error instead of timing out", async () => {
    const transport = new StreamPullFailureTransport();

    await expect(
      executeConsumerCommand({
        transport,
        session,
        agentId: "agent-1",
        command: {
          jsonrpc: "2.0",
          method: "sql.execute",
          id: "request-1",
          params: { sql: "SELECT 1" },
        },
        responseMode: "aggregatedJson",
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "STREAM_LOST",
    });
  });
});
