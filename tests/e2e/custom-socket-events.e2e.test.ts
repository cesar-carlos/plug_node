import { describe, expect, it } from "vitest";

import type { CustomSocketEventAttachment } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/contracts/custom-socket-events";
import {
  publishCustomSocketEventOverSocket,
  waitForCustomSocketEvent,
  type CustomSocketEventTransport,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/customSocketEventSession";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/socket/payloadFrameCodec";

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
      readonly attachments?: readonly CustomSocketEventAttachment[];
    },
  ): void {
    const recipients = [
      ...(this.subscriptions.get(payload.eventName) ?? new Set()),
    ].filter((subscriber) => subscriber.connected);
    const eventId = `event-${payload.requestId}`;

    queueMicrotask(() => {
      transport.dispatch("socket:event.published", {
        success: true,
        requestId: payload.requestId,
        data: {
          eventId,
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
              eventId,
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
          readonly attachments?: readonly CustomSocketEventAttachment[];
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

const waitUntil = async (predicate: () => boolean, timeoutMs = 1000): Promise<void> => {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for test condition");
    }

    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("Custom Socket Events mocked e2e", () => {
  it("publishes over socket and resolves a one-shot wait listener", async () => {
    const environment = new BrokeredSocketEnvironment();
    const listenerTransport = new BrokeredCustomEventTransport(
      environment,
      "socket-listener",
    );
    const publisherTransport = new BrokeredCustomEventTransport(
      environment,
      "socket-publisher",
    );
    const attachment = {
      fieldName: "files",
      originalName: "status.txt",
      mimeType: "text/plain",
      sizeBytes: 5,
      base64: Buffer.from("ready").toString("base64"),
    } satisfies CustomSocketEventAttachment;

    const waitPromise = waitForCustomSocketEvent({
      transport: listenerTransport,
      eventName: "client:custom.status.changed",
      ackTimeoutMs: 1000,
      listenTimeoutMs: 1000,
    });

    await waitUntil(() =>
      listenerTransport.emittedEvents.some(
        ({ event }) => event === "socket:event.subscribe",
      ),
    );

    const publishResult = await publishCustomSocketEventOverSocket({
      transport: publisherTransport,
      request: {
        eventName: "client:custom.status.changed",
        payload: { status: "ready" },
        idempotencyKey: "mocked-e2e",
        attachments: [attachment],
      },
      ackTimeoutMs: 1000,
    });
    const waitResult = await waitPromise;

    expect(publishResult).toMatchObject({
      eventName: "client:custom.status.changed",
      recipients: 1,
      idempotencyKey: "mocked-e2e",
      idempotentReplay: false,
      publisherSocketId: "socket-publisher",
    });
    expect(waitResult.event).toMatchObject({
      eventName: "client:custom.status.changed",
      payload: { status: "ready" },
      attachments: [attachment],
    });
    expect(waitResult.metadata).toMatchObject({
      eventName: "client:custom.status.changed",
      socketId: "socket-listener",
      subscriptionCount: 1,
    });
    expect(
      listenerTransport.emittedEvents.some(
        ({ event }) => event === "socket:event.unsubscribe",
      ),
    ).toBe(true);
    expect(listenerTransport.connected).toBe(false);
    expect(publisherTransport.connected).toBe(false);
  });
});
