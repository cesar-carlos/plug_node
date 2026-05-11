import { describe, expect, it } from "vitest";

import type {
  PlugHttpRequestOptions,
  PlugSession,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/api";
import {
  assertCustomSocketEventFramePayload,
  assertCustomSocketEventName,
  assertSocketEventControlAck,
  toAttachmentMetadata,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/custom-socket-events";
import { publishCustomSocketEvent } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/rest/customSocketEvents";
import {
  startCustomSocketEventSession,
  type CustomSocketEventTransport,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/customSocketEventSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

class MockCustomEventTransport implements CustomSocketEventTransport {
  connected = false;
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

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
    const handlers = this.handlers.get(event) ?? new Set<(payload: unknown) => void>();
    handlers.add(handler);
    this.handlers.set(event, handlers);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });
    if (event === "socket:event.subscribe") {
      const request = payload as {
        readonly requestId: string;
        readonly eventName: string;
      };
      queueMicrotask(() => {
        this.dispatch("socket:event.subscribed", {
          success: true,
          requestId: "other-request",
          data: { eventName: request.eventName, subscribed: true },
        });
        this.dispatch("socket:event.subscribed", {
          success: true,
          requestId: request.requestId,
          data: { eventName: request.eventName, subscribed: true },
        });
      });
    }

    if (event === "socket:event.unsubscribe") {
      const request = payload as {
        readonly requestId: string;
        readonly eventName: string;
      };
      queueMicrotask(() => {
        this.dispatch("socket:event.unsubscribed", {
          success: true,
          requestId: request.requestId,
          data: { eventName: request.eventName, subscribed: false },
        });
      });
    }
  }

  dispatch(event: string, payload: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(payload);
    }
  }
}

class RateLimitedSubscribeTransport extends MockCustomEventTransport {
  override emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });
    if (event === "socket:event.subscribe") {
      const request = payload as { readonly requestId: string };
      queueMicrotask(() => {
        this.dispatch("socket:event.subscribed", {
          success: false,
          requestId: request.requestId,
          error: {
            code: "RATE_LIMITED",
            message: "slow down",
            statusCode: 429,
            retryAfterMs: 2500,
          },
          rateLimit: {
            limit: 10,
            remaining: 0,
            resetAtMs: Date.now() + 2500,
          },
        });
      });
      return;
    }

    super.emit(event, payload);
  }
}

class PartialSubscribeFailureTransport extends MockCustomEventTransport {
  private subscribeCount = 0;

  override emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });
    if (event === "socket:event.subscribe") {
      this.subscribeCount += 1;
      const request = payload as {
        readonly requestId: string;
        readonly eventName: string;
      };
      queueMicrotask(() => {
        if (this.subscribeCount === 1) {
          this.dispatch("socket:event.subscribed", {
            success: true,
            requestId: request.requestId,
            data: { eventName: request.eventName, subscribed: true },
          });
          return;
        }

        this.dispatch("socket:event.subscribed", {
          success: false,
          requestId: request.requestId,
          error: {
            code: "SUBSCRIPTION_LIMIT_EXCEEDED",
            message: "too many subscriptions",
          },
        });
      });
      return;
    }

    super.emit(event, payload);
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

describe("custom socket events", () => {
  it("validates custom event names against the server contract", () => {
    expect(assertCustomSocketEventName(" client:custom.status.changed ")).toBe(
      "client:custom.status.changed",
    );
    expect(() => assertCustomSocketEventName("client:agent.profile.updated")).toThrow(
      "Event Name must start with client:custom.",
    );
    expect(() => assertCustomSocketEventName("client:custom.*")).toThrow(
      "Event Name must start with client:custom.",
    );
  });

  it("publishes JSON events with idempotency and parses the accepted response", async () => {
    const requests: PlugHttpRequestOptions[] = [];
    const response = await publishCustomSocketEvent(
      async (options) => {
        requests.push(options);
        return {
          statusCode: 202,
          headers: {},
          body: {
            success: true,
            eventId: "event-1",
            eventName: "client:custom.status.changed",
            recipients: 2,
            idempotencyKey: "publish-1",
            idempotentReplay: false,
            requestId: "req-1",
          },
        };
      },
      session,
      {
        eventName: "client:custom.status.changed",
        payload: null,
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
      },
    );

    expect(response).toMatchObject({ eventId: "event-1", recipients: 2 });
    expect(requests[0]).toMatchObject({
      method: "POST",
      url: "https://plug-server.example.com/api/v1/client/me/socket-events",
      body: {
        eventName: "client:custom.status.changed",
        payload: null,
        payloadFrameCompression: "default",
      },
    });
    expect(requests[0].headers).toMatchObject({
      authorization: "Bearer access-1",
      "idempotency-key": "publish-1",
    });
  });

  it("rejects malformed publish responses", async () => {
    await expect(
      publishCustomSocketEvent(
        async () => ({
          statusCode: 202,
          headers: {},
          body: { success: true, eventName: "client:custom.status.changed" },
        }),
        session,
        { eventName: "client:custom.status.changed", payload: {} },
      ),
    ).rejects.toThrow("Plug socket event publish response is missing eventId");
  });

  it("subscribes, ignores divergent acks, decodes dynamic PayloadFrames, and unsubscribes", async () => {
    const transport = new MockCustomEventTransport();
    const received: unknown[] = [];
    const sessionHandle = await startCustomSocketEventSession({
      transport,
      eventNames: ["client:custom.status.changed"],
      ackTimeoutMs: 1000,
      onFatalError: (error) => {
        throw error;
      },
      onEvent: (event) => {
        received.push(event);
      },
    });

    transport.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-1",
          eventName: "client:custom.status.changed",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [
            {
              fieldName: "files",
              originalName: "hello.txt",
              mimeType: "text/plain",
              sizeBytes: 5,
              base64: Buffer.from("hello").toString("base64"),
            },
          ],
        },
        { requestId: "event-1", compression: "none" },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await sessionHandle.close();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      eventId: "event-1",
      payload: { status: "ready" },
    });
    expect(
      transport.emittedEvents.some(({ event }) => event === "socket:event.unsubscribe"),
    ).toBe(true);
  });

  it("propagates subscription rate-limit metadata", async () => {
    await expect(
      startCustomSocketEventSession({
        transport: new RateLimitedSubscribeTransport(),
        eventNames: ["client:custom.status.changed"],
        ackTimeoutMs: 1000,
        onFatalError: (error) => {
          throw error;
        },
        onEvent: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      retryable: true,
      retryAfterSeconds: 3,
      details: {
        rateLimit: {
          limit: 10,
          remaining: 0,
        },
      },
    });
  });

  it("requires requestId on failed control acks", () => {
    expect(() =>
      assertSocketEventControlAck({
        success: false,
        error: {
          code: "RATE_LIMITED",
          message: "slow down",
        },
      }),
    ).toThrow("socket:event ack failure must include requestId");
  });

  it("best-effort unsubscribes already subscribed events after partial activation failure", async () => {
    const transport = new PartialSubscribeFailureTransport();

    await expect(
      startCustomSocketEventSession({
        transport,
        eventNames: ["client:custom.status.changed", "client:custom.invoice.created"],
        ackTimeoutMs: 1000,
        onFatalError: (error) => {
          throw error;
        },
        onEvent: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "SUBSCRIPTION_LIMIT_EXCEEDED",
    });

    expect(
      transport.emittedEvents.some(
        ({ event, payload }) =>
          event === "socket:event.unsubscribe" &&
          (payload as { eventName?: string }).eventName ===
            "client:custom.status.changed",
      ),
    ).toBe(true);
  });

  it("rejects attachment payloads whose decoded base64 size does not match sizeBytes", () => {
    expect(() =>
      assertCustomSocketEventFramePayload({
        eventId: "event-1",
        eventName: "client:custom.status.changed",
        emittedAt: "2026-05-11T12:00:00.000Z",
        publisher: {},
        payload: null,
        attachments: [
          {
            fieldName: "files",
            originalName: "hello.txt",
            mimeType: "text/plain",
            sizeBytes: 99,
            base64: Buffer.from("hello").toString("base64"),
          },
        ],
      }),
    ).toThrow("sizeBytes does not match");
  });

  it("strips attachment base64 from metadata helpers", () => {
    expect(
      toAttachmentMetadata({
        fieldName: "files",
        originalName: "hello.txt",
        mimeType: "text/plain",
        sizeBytes: 5,
        base64: "aGVsbG8=",
      }),
    ).toEqual({
      fieldName: "files",
      originalName: "hello.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
    });
  });
});
