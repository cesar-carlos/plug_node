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
import {
  createSocketApplicationError,
  createSocketConnectError,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/socketErrors";
import {
  agentsCommandRequestFixture,
  agentsCommandResponseFixture,
  agentsCommandStreamChunkFixture,
  agentsCommandStreamCompleteFixture,
  agentsCommandStreamResponseFixture,
  agentsStreamPullResponseFixture,
  socketAppErrorFixtures,
  socketProtocolRequestId,
  socketProtocolStreamId,
} from "../fixtures/socketProtocolFixtures";

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

class ContractTransport implements ConsumerSocketTransport {
  connected = false;
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(private readonly mode: "single" | "stream") {}

  connect(): void {
    this.connected = true;
    queueMicrotask(() => {
      this.dispatch(
        "connection:ready",
        encodePayloadFrame(
          {
            id: "socket-1",
            message: "ready",
            user: { sub: "client-1" },
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
    const handlers = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });

    if (event === "agents:command") {
      queueMicrotask(() => {
        this.dispatch(
          "agents:command_response",
          this.mode === "stream"
            ? agentsCommandStreamResponseFixture
            : agentsCommandResponseFixture,
        );
      });
      return;
    }

    if (event === "agents:stream_pull") {
      queueMicrotask(() => {
        this.dispatch("agents:stream_pull_response", agentsStreamPullResponseFixture);
        this.dispatch("agents:command_stream_chunk", {
          ...agentsCommandStreamChunkFixture,
          request_id: "stale-request",
        });
        this.dispatch("agents:command_stream_chunk", agentsCommandStreamChunkFixture);
        this.dispatch(
          "agents:command_stream_complete",
          agentsCommandStreamCompleteFixture,
        );
      });
    }
  }

  private dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

describe("socket protocol contracts", () => {
  it("emits the agents:command envelope and accepts only correlated response fixtures", async () => {
    const transport = new ContractTransport("single");

    const result = await executeConsumerCommand({
      transport,
      session,
      agentId: agentsCommandRequestFixture.agentId,
      command: agentsCommandRequestFixture.command,
      responseMode: "aggregatedJson",
      timeoutMs: agentsCommandRequestFixture.timeoutMs,
      payloadFrameCompression: "default",
    });

    expect(transport.emittedEvents[0]).toMatchObject({
      event: "agents:command",
      payload: agentsCommandRequestFixture,
    });
    expect(result).toMatchObject({
      socketMode: "agentsCommand",
      requestId: socketProtocolRequestId,
      response: agentsCommandResponseFixture.response,
      metrics: {
        ignoredCommandResponses: 0,
        streamChunks: 0,
      },
    });
  });

  it("keeps stream pull, chunk, and complete fixtures bound to requestId and streamId", async () => {
    const transport = new ContractTransport("stream");

    const result = await executeConsumerCommand({
      transport,
      session,
      agentId: agentsCommandRequestFixture.agentId,
      command: agentsCommandRequestFixture.command,
      responseMode: "aggregatedJson",
      timeoutMs: agentsCommandRequestFixture.timeoutMs,
      payloadFrameCompression: "default",
    });

    expect(
      transport.emittedEvents.some(
        ({ event, payload }) =>
          event === "agents:stream_pull" &&
          (payload as { readonly requestId?: string }).requestId ===
            socketProtocolRequestId &&
          (payload as { readonly streamId?: string }).streamId === socketProtocolStreamId,
      ),
    ).toBe(true);
    expect(result.response).toMatchObject({
      item: {
        result: {
          rows: [{ id: 1 }, { id: 2 }],
        },
      },
    });
    expect(result).toMatchObject({
      metrics: {
        ignoredStreamChunks: 1,
        streamPullRequests: 1,
        streamChunks: 1,
      },
    });
  });

  it("classifies shared socket auth errors consistently across socket surfaces", () => {
    const connectTokenExpired = createSocketConnectError(
      socketAppErrorFixtures.tokenExpired,
      {
        refreshDescription: "refresh and reconnect",
        retryDescription: "retry later",
      },
    );
    const appTokenExpired = createSocketApplicationError(
      socketAppErrorFixtures.tokenExpired,
      {
        refreshDescription: "refresh and reconnect",
      },
    );
    const blocked = createSocketConnectError(socketAppErrorFixtures.accountBlocked, {
      refreshDescription: "refresh and reconnect",
      retryDescription: "retry later",
    });
    const revoked = createSocketApplicationError(
      socketAppErrorFixtures.agentAccessRevoked,
      {
        refreshDescription: "refresh and reconnect",
      },
    );

    expect(connectTokenExpired).toMatchObject({
      code: "TOKEN_EXPIRED",
      retryable: true,
      authRelated: true,
    });
    expect(appTokenExpired).toMatchObject({
      code: "TOKEN_EXPIRED",
      retryable: true,
      authRelated: true,
    });
    expect(blocked).toMatchObject({
      code: "ACCOUNT_BLOCKED",
      retryable: false,
      authRelated: true,
    });
    expect(revoked).toMatchObject({
      code: "AGENT_ACCESS_REVOKED",
      retryable: false,
      authRelated: true,
    });
  });
});
