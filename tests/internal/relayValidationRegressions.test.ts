import { describe, expect, it } from "vitest";

import type {
  PlugSession,
  RpcSingleCommand,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { PlugError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/relaySession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";

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
  id: "request-1",
  params: { client_token: "client-token" },
};

class StubRelayTransport implements RelaySocketTransport {
  connected = false;
  readonly emitted: string[] = [];
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(private readonly conversationStartedPayload: unknown) {}

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
    const set = this.handlers.get(event) ?? new Set();
    set.add(handler);
    this.handlers.set(event, set);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string): void {
    this.emitted.push(event);
    if (event === "relay:conversation.start") {
      queueMicrotask(() => {
        this.dispatch("relay:conversation.started", this.conversationStartedPayload);
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe("G-01: normalizeConversationStarted strict validation", () => {
  it("rejects conversation.started payload without success boolean", async () => {
    const transport = new StubRelayTransport({ conversationId: "abc" });

    await expect(
      executeRelayCommand({
        transport,
        session,
        agentId: "agent-1",
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/relay:conversation\.started.*success boolean/i),
    });
  });

  it("rejects success payload without conversationId", async () => {
    const transport = new StubRelayTransport({ success: true });

    await expect(
      executeRelayCommand({
        transport,
        session,
        agentId: "agent-1",
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/conversationId/),
    });
  });

  it("rejects failure payload missing error.code", async () => {
    const transport = new StubRelayTransport({
      success: false,
      error: { message: "oops" },
    });

    await expect(
      executeRelayCommand({
        transport,
        session,
        agentId: "agent-1",
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/error\.code and error\.message/),
    });
  });

  it("accepts a well-formed failure payload and surfaces it as a relay control error", async () => {
    const transport = new StubRelayTransport({
      success: false,
      error: { code: "RELAY_CONVERSATION_START_FAILED", message: "agent unreachable" },
    });

    await expect(
      executeRelayCommand({
        transport,
        session,
        agentId: "agent-1",
        command,
        responseMode: "aggregatedJson",
        timeoutMs: 1000,
      }),
    ).rejects.toMatchObject<Partial<PlugError>>({
      code: "RELAY_CONVERSATION_START_FAILED",
    });
  });
});
