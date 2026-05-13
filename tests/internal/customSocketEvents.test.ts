import { describe, expect, it, vi } from "vitest";

import type {
  PlugHttpRequestOptions,
  PlugSession,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/api";
import {
  assertAgentProfileUpdatedPayload,
  assertCustomSocketEventFramePayload,
  assertCustomSocketEventName,
  assertPublishCustomSocketEventInput,
  assertSocketEventPublishedAck,
  clientAgentProfileUpdatedEventName,
  assertSocketEventControlAck,
  defaultSocketEventListenTimeoutMaxMs,
  toAttachmentMetadata,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/custom-socket-events";
import { publishCustomSocketEvent } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/rest/customSocketEvents";
import {
  publishCustomSocketEventOverSocket,
  startAgentProfileUpdatedSession,
  startCustomSocketEventSession,
  waitForCustomSocketEvent,
  type CustomSocketEventTransport,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/customSocketEventSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

class MockCustomEventTransport implements CustomSocketEventTransport {
  connected = false;
  readonly id = "socket-1";
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];

  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(private readonly readyFrame?: unknown) {}

  connect(): void {
    this.connected = true;
    queueMicrotask(() => {
      this.dispatch(
        "connection:ready",
        this.readyFrame ??
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

    if (event === "socket:event.publish") {
      const request = payload as {
        readonly requestId: string;
        readonly eventName: string;
        readonly idempotencyKey?: string;
      };
      queueMicrotask(() => {
        this.dispatch("socket:event.published", {
          success: true,
          requestId: "other-request",
          data: {
            eventId: "event-other",
            eventName: request.eventName,
            recipients: 1,
            idempotentReplay: false,
          },
        });
        this.dispatch("socket:event.published", {
          success: true,
          requestId: request.requestId,
          data: {
            eventId: "event-1",
            eventName: request.eventName,
            recipients: 2,
            idempotencyKey: request.idempotencyKey,
            idempotentReplay: false,
          },
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

class ImmediateEventAfterSubscribeAckTransport extends MockCustomEventTransport {
  override emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });
    if (event === "socket:event.subscribe") {
      const request = payload as {
        readonly requestId: string;
        readonly eventName: string;
      };
      queueMicrotask(() => {
        this.dispatch("socket:event.subscribed", {
          success: true,
          requestId: request.requestId,
          data: { eventName: request.eventName, subscribed: true },
        });
        this.dispatch(
          request.eventName,
          encodePayloadFrame(
            {
              eventId: "event-immediate",
              eventName: request.eventName,
              emittedAt: "2026-05-11T12:00:00.000Z",
              publisher: { principalType: "client", clientId: "client-1" },
              payload: { status: "ready" },
              attachments: [],
            },
            { requestId: "event-immediate", compression: "none" },
          ),
        );
      });
      return;
    }

    super.emit(event, payload);
  }
}

class RateLimitedPublishTransport extends MockCustomEventTransport {
  override emit(event: string, payload?: unknown): void {
    this.emittedEvents.push({ event, payload });
    if (event === "socket:event.publish") {
      const request = payload as { readonly requestId: string };
      queueMicrotask(() => {
        this.dispatch("socket:event.published", {
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

class NeverReadyTransport extends MockCustomEventTransport {
  override connect(): void {
    this.connected = true;
  }
}

class BrokeredSocketEnvironment {
  private readonly subscriptions = new Map<string, Set<BrokeredCustomEventTransport>>();

  connect(transport: BrokeredCustomEventTransport): void {
    queueMicrotask(() => {
      transport.dispatch(
        "connection:ready",
        encodePayloadFrame(
          {
            id: transport.id,
            message: "ready",
            user: { sub: "client-1" },
          },
          { requestId: `handshake-${transport.id}`, compression: "none" },
        ),
      );
    });
  }

  disconnect(transport: BrokeredCustomEventTransport): void {
    for (const subscribers of this.subscriptions.values()) {
      subscribers.delete(transport);
    }
  }

  subscribe(
    transport: BrokeredCustomEventTransport,
    payload: { readonly requestId: string; readonly eventName: string },
  ): void {
    const subscribers =
      this.subscriptions.get(payload.eventName) ??
      new Set<BrokeredCustomEventTransport>();
    subscribers.add(transport);
    this.subscriptions.set(payload.eventName, subscribers);
    queueMicrotask(() => {
      transport.dispatch("socket:event.subscribed", {
        success: true,
        requestId: payload.requestId,
        data: {
          eventName: payload.eventName,
          subscribed: true,
        },
      });
    });
  }

  unsubscribe(
    transport: BrokeredCustomEventTransport,
    payload: { readonly requestId: string; readonly eventName: string },
  ): void {
    this.subscriptions.get(payload.eventName)?.delete(transport);
    queueMicrotask(() => {
      transport.dispatch("socket:event.unsubscribed", {
        success: true,
        requestId: payload.requestId,
        data: {
          eventName: payload.eventName,
          subscribed: false,
        },
      });
    });
  }

  publish(
    transport: BrokeredCustomEventTransport,
    payload: {
      readonly requestId: string;
      readonly eventName: string;
      readonly payload: unknown;
      readonly idempotencyKey?: string;
      readonly attachments?: readonly unknown[];
    },
  ): void {
    const recipients = [
      ...(this.subscriptions.get(payload.eventName) ?? new Set()),
    ].filter((subscriber) => subscriber.connected);

    queueMicrotask(() => {
      transport.dispatch("socket:event.published", {
        success: true,
        requestId: payload.requestId,
        data: {
          eventId: `event-${payload.requestId}`,
          eventName: payload.eventName,
          recipients: recipients.length,
          ...(payload.idempotencyKey ? { idempotencyKey: payload.idempotencyKey } : {}),
          idempotentReplay: false,
        },
      });
    });

    for (const recipient of recipients) {
      queueMicrotask(() => {
        recipient.dispatch(
          payload.eventName,
          encodePayloadFrame(
            {
              eventId: `event-${payload.requestId}`,
              eventName: payload.eventName,
              emittedAt: "2026-05-11T12:00:00.000Z",
              publisher: { principalType: "client", clientId: "client-1" },
              payload: payload.payload,
              attachments: payload.attachments ?? [],
            },
            { requestId: payload.requestId, compression: "none" },
          ),
        );
      });
    }
  }
}

class BrokeredCustomEventTransport implements CustomSocketEventTransport {
  connected = false;
  readonly emittedEvents: Array<{ readonly event: string; readonly payload?: unknown }> =
    [];
  private readonly handlers = new Map<string, Set<(payload: unknown) => void>>();

  constructor(
    private readonly environment: BrokeredSocketEnvironment,
    readonly id: string,
  ) {}

  connect(): void {
    this.connected = true;
    this.environment.connect(this);
  }

  disconnect(): void {
    this.connected = false;
    this.environment.disconnect(this);
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
    if (event === "socket:event.subscribe" && payload) {
      this.environment.subscribe(
        this,
        payload as { readonly requestId: string; readonly eventName: string },
      );
      return;
    }

    if (event === "socket:event.unsubscribe" && payload) {
      this.environment.unsubscribe(
        this,
        payload as { readonly requestId: string; readonly eventName: string },
      );
      return;
    }

    if (event === "socket:event.publish" && payload) {
      this.environment.publish(
        this,
        payload as {
          readonly requestId: string;
          readonly eventName: string;
          readonly payload: unknown;
          readonly idempotencyKey?: string;
          readonly attachments?: readonly unknown[];
        },
      );
    }
  }

  dispatch(event: string, payload: unknown): void {
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

  it("requires REST publish responses to include requestId and idempotentReplay", async () => {
    await expect(
      publishCustomSocketEvent(
        async () => ({
          statusCode: 202,
          headers: {},
          body: {
            success: true,
            eventId: "event-1",
            eventName: "client:custom.status.changed",
            recipients: 1,
          },
        }),
        session,
        { eventName: "client:custom.status.changed", payload: {} },
      ),
    ).rejects.toThrow("Plug socket event publish response is missing idempotentReplay");
  });

  it("validates publish input payload, idempotency key, and attachments", () => {
    expect(() =>
      assertPublishCustomSocketEventInput({
        eventName: "client:custom.status.changed",
        idempotencyKey: "invalid key",
      }),
    ).toThrow("Idempotency Key may contain only");

    expect(() =>
      assertPublishCustomSocketEventInput({
        eventName: "client:custom.status.changed",
      }),
    ).toThrow("publish input is missing payload");

    expect(() =>
      assertPublishCustomSocketEventInput({
        eventName: "client:custom.status.changed",
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

  it("publishes events over Socket and ignores divergent published acks", async () => {
    const transport = new MockCustomEventTransport();

    const response = await publishCustomSocketEventOverSocket({
      transport,
      request: {
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        payloadFrameCompression: "default",
        idempotencyKey: "publish-1",
      },
      ackTimeoutMs: 1000,
    });

    expect(response).toMatchObject({
      success: true,
      eventId: "event-1",
      eventName: "client:custom.status.changed",
      recipients: 2,
      idempotencyKey: "publish-1",
      idempotentReplay: false,
    });
    expect(
      transport.emittedEvents.some(({ event }) => event === "socket:event.publish"),
    ).toBe(true);
    expect(transport.connected).toBe(false);
  });

  it("propagates Socket publish rate-limit metadata", async () => {
    await expect(
      publishCustomSocketEventOverSocket({
        transport: new RateLimitedPublishTransport(),
        request: {
          eventName: "client:custom.status.changed",
          payload: null,
        },
        ackTimeoutMs: 1000,
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

  it("disconnects the transport when Socket publish times out before connection:ready", async () => {
    const transport = new NeverReadyTransport();

    await expect(
      publishCustomSocketEventOverSocket({
        transport,
        request: {
          eventName: "client:custom.status.changed",
          payload: null,
        },
        ackTimeoutMs: 10,
      }),
    ).rejects.toMatchObject({
      code: "PLUG_TIMEOUT",
    });

    expect(transport.connected).toBe(false);
  });

  it("delivers an event when the publisher connects after the listener has already subscribed", async () => {
    const environment = new BrokeredSocketEnvironment();
    const listenerTransport = new BrokeredCustomEventTransport(
      environment,
      "socket-listener",
    );
    const publisherTransport = new BrokeredCustomEventTransport(
      environment,
      "socket-publisher",
    );
    const received: unknown[] = [];

    const sessionHandle = await startCustomSocketEventSession({
      transport: listenerTransport,
      eventNames: ["client:custom.status.changed"],
      ackTimeoutMs: 1000,
      onFatalError: (error) => {
        throw error;
      },
      onEvent: (event) => {
        received.push(event);
      },
    });

    const response = await publishCustomSocketEventOverSocket({
      transport: publisherTransport,
      request: {
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        idempotencyKey: "publish-ordered",
      },
      ackTimeoutMs: 1000,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    await sessionHandle.close();

    expect(response).toMatchObject({
      recipients: 1,
      requestId: expect.any(String),
      idempotentReplay: false,
      publisherSocketId: "socket-publisher",
    });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      eventName: "client:custom.status.changed",
      payload: { status: "ready" },
    });
  });

  it("waits for one custom socket event and closes after success", async () => {
    const transport = new MockCustomEventTransport();
    const waitPromise = waitForCustomSocketEvent({
      transport,
      eventName: "client:custom.status.changed",
      ackTimeoutMs: 1000,
      listenTimeoutMs: 1000,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-wait-1",
          eventName: "client:custom.status.changed",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [],
        },
        { requestId: "event-wait-1", compression: "none" },
      ),
    );

    const result = await waitPromise;

    expect(result.event).toMatchObject({
      eventId: "event-wait-1",
      eventName: "client:custom.status.changed",
      payload: { status: "ready" },
    });
    expect(result.metadata).toMatchObject({
      eventName: "client:custom.status.changed",
      socketId: "socket-1",
      subscriptionCount: 1,
      payloadFrameRequestId: "event-wait-1",
    });
    expect(
      transport.emittedEvents.some(({ event }) => event === "socket:event.unsubscribe"),
    ).toBe(true);
    expect(transport.connected).toBe(false);
  });

  it("rejects one-shot custom socket waits on listen timeout", async () => {
    const transport = new MockCustomEventTransport();

    await expect(
      waitForCustomSocketEvent({
        transport,
        eventName: "client:custom.status.changed",
        ackTimeoutMs: 1000,
        listenTimeoutMs: 1,
      }),
    ).rejects.toMatchObject({
      code: "SOCKET_EVENT_LISTEN_TIMEOUT",
      details: {
        timeoutMs: 1,
        eventName: "client:custom.status.changed",
      },
    });

    expect(transport.connected).toBe(false);
  });

  it("rejects one-shot custom socket waits before connecting when signature verification has no key", async () => {
    const transport = new MockCustomEventTransport();

    await expect(
      waitForCustomSocketEvent({
        transport,
        eventName: "client:custom.status.changed",
        ackTimeoutMs: 1000,
        listenTimeoutMs: 1000,
        payloadFrameSigning: { keyId: "test-key" },
        requirePayloadSignature: true,
      }),
    ).rejects.toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message:
        "Payload Signing Key is required when Require Payload Signature is enabled.",
    });

    expect(transport.connected).toBe(false);
    expect(transport.emittedEvents).toHaveLength(0);
  });

  it("rejects one-shot custom socket waits above the listen timeout limit", async () => {
    const transport = new MockCustomEventTransport();

    await expect(
      waitForCustomSocketEvent({
        transport,
        eventName: "client:custom.status.changed",
        listenTimeoutMs: defaultSocketEventListenTimeoutMaxMs + 1,
      }),
    ).rejects.toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: `Listen Timeout (MS) must be at most ${defaultSocketEventListenTimeoutMaxMs}`,
    });

    expect(transport.connected).toBe(false);
  });

  it("rejects one-shot custom socket waits with invalid event payloads", async () => {
    const transport = new MockCustomEventTransport();
    const waitPromise = waitForCustomSocketEvent({
      transport,
      eventName: "client:custom.status.changed",
      ackTimeoutMs: 1000,
      listenTimeoutMs: 1000,
    });
    const rejection = expect(waitPromise).rejects.toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-invalid",
          eventName: "client:custom.other",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [],
        },
        { requestId: "event-invalid", compression: "none" },
      ),
    );

    await rejection;
    expect(transport.connected).toBe(false);
  });

  it("requires signed PayloadFrames for one-shot custom socket waits when configured", async () => {
    const transport = new MockCustomEventTransport();
    const waitPromise = waitForCustomSocketEvent({
      transport,
      eventName: "client:custom.status.changed",
      ackTimeoutMs: 1000,
      listenTimeoutMs: 1000,
      payloadFrameSigning: { key: "secret" },
      requirePayloadSignature: true,
    });
    const rejection = expect(waitPromise).rejects.toThrow(
      "PayloadFrame signature is required",
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    transport.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-unsigned",
          eventName: "client:custom.status.changed",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: { status: "ready" },
          attachments: [],
        },
        { requestId: "event-unsigned", compression: "none" },
      ),
    );

    await rejection;
    expect(transport.connected).toBe(false);
  });

  it("validates socket:event.published ack shape", () => {
    expect(() =>
      assertSocketEventPublishedAck({
        success: true,
        requestId: "request-1",
        data: {
          eventName: "client:custom.status.changed",
          recipients: 1,
          idempotentReplay: false,
        },
      }),
    ).toThrow("socket:event.published data is missing eventId");
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

  it("deduplicates custom socket events by eventId when a TTL is configured", async () => {
    const transport = new MockCustomEventTransport();
    const received: unknown[] = [];
    const sessionHandle = await startCustomSocketEventSession({
      transport,
      eventNames: ["client:custom.status.changed"],
      ackTimeoutMs: 1000,
      deduplicateEventIdsTtlMs: 300_000,
      onFatalError: (error) => {
        throw error;
      },
      onEvent: (event) => {
        received.push(event);
      },
    });
    const frame = encodePayloadFrame(
      {
        eventId: "event-duplicate",
        eventName: "client:custom.status.changed",
        emittedAt: "2026-05-11T12:00:00.000Z",
        publisher: { principalType: "client", clientId: "client-1" },
        payload: { status: "ready" },
        attachments: [],
      },
      { requestId: "event-duplicate", compression: "none" },
    );

    transport.dispatch("client:custom.status.changed", frame);
    transport.dispatch("client:custom.status.changed", frame);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await sessionHandle.close();

    expect(received).toHaveLength(1);
  });

  it("does not drop an event emitted immediately after subscribe ack", async () => {
    const transport = new ImmediateEventAfterSubscribeAckTransport();
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

    await new Promise((resolve) => setTimeout(resolve, 0));
    await sessionHandle.close();

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      eventId: "event-immediate",
      eventName: "client:custom.status.changed",
    });
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

  it("disconnects the transport when custom event activation times out before connection:ready", async () => {
    const transport = new NeverReadyTransport();

    await expect(
      startCustomSocketEventSession({
        transport,
        eventNames: ["client:custom.status.changed"],
        ackTimeoutMs: 10,
        onFatalError: (error) => {
          throw error;
        },
        onEvent: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: "PLUG_TIMEOUT",
    });

    expect(transport.connected).toBe(false);
  });

  it("requires PayloadFrame signatures when configured", async () => {
    const signing = { key: "test-signing-key", keyId: "test-key" };
    const transport = new MockCustomEventTransport(
      encodePayloadFrame(
        {
          id: "socket-1",
          message: "ready",
          user: { sub: "client-1" },
        },
        { requestId: "handshake", compression: "none", signing },
      ),
    );
    const failures: unknown[] = [];
    const sessionHandle = await startCustomSocketEventSession({
      transport,
      eventNames: ["client:custom.status.changed"],
      ackTimeoutMs: 1000,
      payloadFrameSigning: signing,
      requirePayloadSignature: true,
      onFatalError: (error) => {
        failures.push(error);
      },
      onEvent: () => undefined,
    });

    transport.dispatch(
      "client:custom.status.changed",
      encodePayloadFrame(
        {
          eventId: "event-1",
          eventName: "client:custom.status.changed",
          emittedAt: "2026-05-11T12:00:00.000Z",
          publisher: { principalType: "client", clientId: "client-1" },
          payload: null,
          attachments: [],
        },
        { requestId: "event-1", compression: "none" },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await sessionHandle.close();

    expect(failures[0]).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "PayloadFrame signature is required",
    });
  });

  it("decodes agent profile updated events", async () => {
    const transport = new MockCustomEventTransport();
    const received: unknown[] = [];
    const sessionHandle = await startAgentProfileUpdatedSession({
      transport,
      ackTimeoutMs: 1000,
      onFatalError: (error) => {
        throw error;
      },
      onEvent: (event, metadata) => {
        received.push({ event, metadata });
      },
    });

    transport.dispatch(
      clientAgentProfileUpdatedEventName,
      encodePayloadFrame(
        {
          success: true,
          agentId: "agent-1",
          profileVersion: 2,
          profileUpdatedAt: "2026-05-11T12:00:00.000Z",
          changedFields: ["name"],
        },
        { requestId: "profile-1", compression: "none" },
      ),
    );

    await new Promise((resolve) => setTimeout(resolve, 0));
    await sessionHandle.close();

    expect(received[0]).toMatchObject({
      event: {
        success: true,
        agentId: "agent-1",
        profileVersion: 2,
      },
      metadata: {
        eventName: clientAgentProfileUpdatedEventName,
        socketId: "socket-1",
        payloadFrameRequestId: "profile-1",
      },
    });
  });

  it("validates agent profile updated timestamps", () => {
    expect(() =>
      assertAgentProfileUpdatedPayload({
        success: true,
        agent_id: "agent-1",
        profile_version: 2,
        profileUpdatedAt: "not-a-date",
      }),
    ).toThrow("profileUpdatedAt must be an ISO date string");
  });

  it("requires agent profile updated minimum server fields", () => {
    expect(() =>
      assertAgentProfileUpdatedPayload({
        success: false,
        agent_id: "agent-1",
        profile_version: 2,
      }),
    ).toThrow("success must be true");

    expect(() =>
      assertAgentProfileUpdatedPayload({
        success: true,
        profile_version: 2,
      }),
    ).toThrow("missing agent_id");

    expect(() =>
      assertAgentProfileUpdatedPayload({
        success: true,
        agent_id: "agent-1",
      }),
    ).toThrow("missing profile_version");
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
