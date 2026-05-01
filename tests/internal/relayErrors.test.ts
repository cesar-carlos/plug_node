import { describe, expect, it } from "vitest";

import type {
  PlugSession,
  RpcSingleCommand,
} from "../../packages/n8n-nodes-plug-client-internal/generated/shared/contracts/api";
import { PlugError } from "../../packages/n8n-nodes-plug-client-internal/generated/shared/contracts/errors";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../packages/n8n-nodes-plug-client-internal/generated/shared/socket/relaySession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-client-internal/generated/shared/socket/payloadFrameCodec";

class ErrorRelayTransport implements RelaySocketTransport {
  connected = false;
  readonly emittedEvents: string[] = [];

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(private readonly errorCode: string) {}

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
          },
          { requestId: "handshake", compression: "none" },
        ),
      );
    });
  }

  disconnect(): void {
    this.connected = false;
  }

  on(event: string, handler: (payload: unknown) => void): void {
    const eventHandlers =
      this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    eventHandlers.add(handler);
    this.handlers.set(event, eventHandlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string): void {
    this.emittedEvents.push(event);

    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", {
          success: true,
          conversationId: "conversation-1",
          agentId: "agent-1",
          createdAt: new Date().toISOString(),
        });
      });
      return;
    }

    if (event === "relay:rpc.request") {
      queueMicrotask(() => {
        this.dispatch("app:error", {
          code: this.errorCode,
          message: `${this.errorCode} rejected the relay operation`,
          details: {
            status: "denied",
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

const session: PlugSession = {
  credentials: {
    user: "client@example.com",
    password: "secret",
    agentId: "agent-1",
    clientToken: "client-token",
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

const command: RpcSingleCommand = {
  jsonrpc: "2.0",
  method: "client_token.getPolicy",
  id: "client-request-1",
  params: {
    client_token: "client-token",
  },
};

describe("executeRelayCommand app errors", () => {
  it.each(["ACCOUNT_BLOCKED", "AGENT_ACCESS_REVOKED"])(
    "surfaces %s as a PlugError",
    async (errorCode) => {
      const transport = new ErrorRelayTransport(errorCode);

      await expect(
        executeRelayCommand({
          transport,
          session,
          command,
          responseMode: "aggregatedJson",
          timeoutMs: 5000,
        }),
      ).rejects.toMatchObject<Partial<PlugError>>({
        code: errorCode,
      });

      expect(transport.connected).toBe(false);
      expect(transport.emittedEvents).toContain("relay:conversation.end");
    },
  );

  it("adds a clearer message when the account is blocked", async () => {
    const transport = new ErrorRelayTransport("ACCOUNT_BLOCKED");

    await expect(
      executeRelayCommand({
        transport,
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "ACCOUNT_BLOCKED",
      message: "The Plug account is blocked.",
      description:
        "The server closed the socket because the user or client account is blocked.",
    });
  });

  it("adds a clearer message when agent access was revoked", async () => {
    const transport = new ErrorRelayTransport("AGENT_ACCESS_REVOKED");

    await expect(
      executeRelayCommand({
        transport,
        session,
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 5000,
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "AGENT_ACCESS_REVOKED",
      message: "Client access to this agent was revoked.",
      description:
        "Ask the agent owner to approve access again or update the credential before retrying.",
    });
  });
});
