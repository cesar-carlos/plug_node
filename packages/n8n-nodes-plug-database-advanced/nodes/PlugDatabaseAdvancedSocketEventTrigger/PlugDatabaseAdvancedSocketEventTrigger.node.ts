import { Buffer } from "node:buffer";

import { io, type Socket } from "socket.io-client";
import type {
  IBinaryKeyData,
  IDataObject,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  ITriggerFunctions,
  ITriggerResponse,
} from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import {
  DEFAULT_BASE_URL,
  type PlugCredentialDefaults,
} from "../../generated/shared/contracts/api";
import { createExecutionSessionRunner } from "../../generated/shared/auth/session";
import { PlugError } from "../../generated/shared/contracts/errors";
import {
  assertCustomSocketEventNames,
  clientAgentProfileUpdatedEventName,
  defaultBinaryPropertyPrefix,
  defaultMaxInflightSocketEvents,
  defaultMaxQueuedSocketEvents,
  defaultManualListenTimeoutMs,
  defaultSocketEventAckTimeoutMs,
  defaultSocketEventDeduplicationTtlMs,
  type AgentProfileUpdatedPayload,
  toAttachmentMetadata,
  type CustomSocketEventFramePayload,
  type SocketEventOverflowPolicy,
  type SocketEventRuntimeMetadata,
} from "../../generated/shared/contracts/custom-socket-events";
import { plugLogger } from "../../generated/shared/logging/plugLogger";
import { buildN8nHttpRequester } from "../../generated/shared/n8n/httpRequester";
import {
  startAgentProfileUpdatedSession,
  startCustomSocketEventSession,
  type CustomSocketEventSession,
  type CustomSocketEventTransport,
} from "../../generated/shared/socket/customSocketEventSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

const credentialName = "plugDatabaseAdvancedApi";
const defaultReconnectInitialDelayMs = 1000;
const defaultReconnectMaxDelayMs = 30_000;
const defaultReconnectFailureWindowMs = 300_000;

type PayloadSignatureRequirement = "all" | "customEvents" | "agentProfileUpdated";

interface BackpressureSnapshot {
  readonly queuedCount: number;
  readonly inflightCount: number;
  readonly droppedNewestCount: number;
  readonly droppedOldestCount: number;
}

class SocketIoCustomEventTransport implements CustomSocketEventTransport {
  constructor(private readonly socket: Socket) {}

  get id(): string | undefined {
    return this.socket.id;
  }

  get connected(): boolean {
    return this.socket.connected;
  }

  connect(): void {
    this.socket.connect();
  }

  disconnect(): void {
    this.socket.disconnect();
  }

  on(event: string, handler: (payload: unknown) => void): void {
    this.socket.on(event, handler);
  }

  off(event: string, handler: (payload: unknown) => void): void {
    this.socket.off(event, handler);
  }

  emit(event: string, payload?: unknown): void {
    if (payload === undefined) {
      this.socket.emit(event);
      return;
    }

    this.socket.emit(event, payload);
  }
}

const readCredentials = async (
  context: ITriggerFunctions,
): Promise<PlugCredentialDefaults> => {
  const rawCredentials = await context.getCredentials(credentialName);
  return {
    user: String(rawCredentials.user ?? ""),
    password: String(rawCredentials.password ?? ""),
    baseUrl: String(rawCredentials.baseUrl ?? DEFAULT_BASE_URL),
    agentId: String(rawCredentials.agentId ?? ""),
    clientToken: String(rawCredentials.clientToken ?? ""),
    payloadSigningKey: String(rawCredentials.payloadSigningKey ?? ""),
    payloadSigningKeyId: String(rawCredentials.payloadSigningKeyId ?? ""),
  };
};

const resolvePayloadFrameSigning = (
  credentials: PlugCredentialDefaults,
):
  | {
      readonly key?: string;
      readonly keyId?: string;
    }
  | undefined => {
  const key = credentials.payloadSigningKey?.trim();
  const keyId = credentials.payloadSigningKeyId?.trim();
  if (!key && !keyId) {
    return undefined;
  }

  return {
    ...(key ? { key } : {}),
    ...(keyId ? { keyId } : {}),
  };
};

const readEventNames = (context: ITriggerFunctions): string[] => {
  const collection = context.getNodeParameter("eventNames", {}) as {
    readonly values?: ReadonlyArray<{ readonly eventName?: unknown }>;
  };

  return assertCustomSocketEventNames(
    (collection.values ?? []).map((row) => row.eventName),
  );
};

const normalizeInteger = (value: unknown, fallback: number, min: number): number => {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim() !== ""
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(numeric)) {
    return fallback;
  }

  return Math.max(min, Math.floor(numeric));
};

const createReconnectCircuitOpenError = (technicalMessage: string): PlugError =>
  new PlugError("Plug socket reconnect circuit breaker opened.", {
    code: "SOCKET_RECONNECT_CIRCUIT_OPEN",
    description:
      "Too many retryable socket failures happened inside the configured reconnect failure window.",
    retryable: true,
    technicalMessage,
  });

const buildTriggerItem = async (
  context: ITriggerFunctions,
  event: CustomSocketEventFramePayload,
  binaryPropertyPrefix: string,
  includeMetadata: boolean,
  metadata: SocketEventRuntimeMetadata,
  backpressure: BackpressureSnapshot,
): Promise<INodeExecutionData> => {
  const binary: IBinaryKeyData = {};

  for (let index = 0; index < event.attachments.length; index += 1) {
    const attachment = event.attachments[index];
    const propertyName = `${binaryPropertyPrefix}_${index}`;
    binary[propertyName] = await context.helpers.prepareBinaryData(
      Buffer.from(attachment.base64.trim(), "base64"),
      attachment.originalName,
      attachment.mimeType,
    );
  }

  const json: IDataObject = {
    eventId: event.eventId,
    eventName: event.eventName,
    emittedAt: event.emittedAt,
    publisher: event.publisher,
    payload: event.payload as IDataObject,
    attachments: event.attachments.map(toAttachmentMetadata) as unknown as IDataObject[],
    ...(includeMetadata
      ? {
          __plug: {
            channel: "socket",
            socketMode: "customEvent",
            eventName: event.eventName,
            eventId: event.eventId,
            receivedAt: new Date().toISOString(),
            socketId: metadata.socketId,
            reconnectAttempt: metadata.reconnectAttempt,
            subscriptionCount: metadata.subscriptionCount,
            payloadFrameRequestId: metadata.payloadFrameRequestId,
            backpressure,
          },
        }
      : {}),
  };

  return {
    json,
    ...(Object.keys(binary).length > 0 ? { binary } : {}),
  };
};

const buildAgentProfileUpdatedItem = (
  event: AgentProfileUpdatedPayload,
  includeMetadata: boolean,
  metadata: SocketEventRuntimeMetadata,
  backpressure: BackpressureSnapshot,
): INodeExecutionData => ({
  json: {
    eventName: clientAgentProfileUpdatedEventName,
    payload: event as IDataObject,
    ...(includeMetadata
      ? {
          __plug: {
            channel: "socket",
            socketMode: "agentProfileUpdated",
            eventName: clientAgentProfileUpdatedEventName,
            receivedAt: new Date().toISOString(),
            socketId: metadata.socketId,
            reconnectAttempt: metadata.reconnectAttempt,
            subscriptionCount: metadata.subscriptionCount,
            payloadFrameRequestId: metadata.payloadFrameRequestId,
            backpressure,
          },
        }
      : {}),
  },
});

const createBackpressureQueue = (input: {
  readonly maxInflightEvents: number;
  readonly maxQueueSize: number;
  readonly overflowPolicy: SocketEventOverflowPolicy;
  readonly emitError: (error: PlugError) => void;
  readonly onDrop?: (
    reason: "dropNewest" | "dropOldest",
    metadata: { readonly queueSize: number },
  ) => void;
}) => {
  const queue: Array<() => Promise<void>> = [];
  let inflight = 0;
  let closed = false;
  let droppedNewestCount = 0;
  let droppedOldestCount = 0;

  const drain = (): void => {
    if (closed) {
      return;
    }

    while (inflight < input.maxInflightEvents && queue.length > 0) {
      const task = queue.shift();
      if (!task) {
        return;
      }

      inflight += 1;
      task()
        .catch((error: unknown) => {
          if (closed) {
            return;
          }

          input.emitError(
            error instanceof PlugError
              ? error
              : new PlugError("Failed to emit Plug socket event item.", {
                  code: "SOCKET_EVENT_EMIT_FAILED",
                  technicalMessage: error instanceof Error ? error.message : undefined,
                }),
          );
        })
        .finally(() => {
          inflight -= 1;
          drain();
        });
    }
  };

  return {
    enqueue(task: () => Promise<void>): void {
      if (closed) {
        return;
      }

      if (inflight < input.maxInflightEvents && queue.length === 0) {
        queue.push(task);
        drain();
        return;
      }

      if (queue.length >= input.maxQueueSize) {
        if (input.overflowPolicy === "dropNewest") {
          droppedNewestCount += 1;
          input.onDrop?.("dropNewest", { queueSize: queue.length });
          return;
        }

        if (input.overflowPolicy === "dropOldest") {
          queue.shift();
          droppedOldestCount += 1;
          input.onDrop?.("dropOldest", { queueSize: queue.length });
        } else {
          input.emitError(
            new PlugError("Plug socket event queue is full.", {
              code: "SOCKET_EVENT_BACKPRESSURE_LIMIT",
              description:
                "Increase Max Queue Size or reduce event volume before retrying.",
              retryable: true,
            }),
          );
          return;
        }
      }

      queue.push(task);
      drain();
    },
    close(): void {
      closed = true;
      queue.length = 0;
    },
    getStats(): BackpressureSnapshot {
      return {
        queuedCount: queue.length,
        inflightCount: inflight,
        droppedNewestCount,
        droppedOldestCount,
      };
    },
  };
};

export class PlugDatabaseAdvancedSocketEventTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: "Plug Database Advanced Socket Event Trigger",
    name: "plugDatabaseAdvancedSocketEventTrigger",
    icon: "file:plugDatabaseAdvancedSocketEventTrigger.svg",
    group: ["trigger"],
    version: 1,
    subtitle: '={{$parameter["eventNames"]?.values?.[0]?.eventName}}',
    description: "Listen for custom Plug Socket events.",
    defaults: {
      name: "Plug Socket Event Trigger",
    },
    usableAsTool: true,
    inputs: [],
    outputs: [NodeConnectionTypes.Main],
    credentials: [
      {
        name: credentialName,
        required: true,
      },
    ],
    properties: [
      {
        displayName: "Event Source",
        name: "eventSource",
        type: "options",
        default: "customEvents",
        options: [
          {
            name: "Agent Profile Updated",
            value: "agentProfileUpdated",
            description: "Listen for client:agent.profile.updated push events",
            action: "Listen for agent profile updates",
          },
          {
            name: "Custom Events",
            value: "customEvents",
            description: "Subscribe to exact client:custom.* event names",
            action: "Listen for custom events",
          },
        ],
        description: "Type of Plug Socket event to listen for",
      },
      {
        displayName: "Event Names",
        name: "eventNames",
        type: "fixedCollection",
        placeholder: "Add event",
        default: {
          values: [{ eventName: "client:custom.status.changed" }],
        },
        displayOptions: {
          show: {
            eventSource: ["customEvents"],
          },
        },
        typeOptions: {
          multipleValues: true,
        },
        options: [
          {
            displayName: "Event",
            name: "values",
            values: [
              {
                displayName: "Event Name",
                name: "eventName",
                type: "string",
                default: "client:custom.status.changed",
                required: true,
                description:
                  "Exact custom event name to subscribe to. Wildcards are not supported by Plug.",
              },
            ],
          },
        ],
      },
      {
        displayName: "Subscription ACK Timeout (MS)",
        name: "ackTimeoutMs",
        type: "number",
        default: defaultSocketEventAckTimeoutMs,
        typeOptions: {
          minValue: 1,
        },
        description: "Time to wait for socket connection and control acknowledgements",
      },
      {
        displayName: "Reconnect On Disconnect",
        name: "reconnectOnDisconnect",
        type: "boolean",
        default: true,
        description:
          "Whether to reconnect and re-subscribe after retryable socket disconnects",
      },
      {
        displayName: "Max Reconnect Attempts",
        name: "maxReconnectAttempts",
        type: "number",
        default: 0,
        typeOptions: {
          minValue: 0,
        },
        displayOptions: {
          show: {
            reconnectOnDisconnect: [true],
          },
        },
        description: "Maximum reconnect attempts. Set 0 for unlimited retries.",
      },
      {
        displayName: "Reconnect Failure Window (MS)",
        name: "reconnectFailureWindowMs",
        type: "number",
        default: defaultReconnectFailureWindowMs,
        typeOptions: {
          minValue: 1000,
        },
        displayOptions: {
          show: {
            reconnectOnDisconnect: [true],
          },
        },
        description:
          "Window used by the reconnect circuit breaker. Set Max Reconnect Failures in Window to 0 to disable the breaker.",
      },
      {
        displayName: "Max Reconnect Failures in Window",
        name: "maxReconnectFailuresInWindow",
        type: "number",
        default: 0,
        typeOptions: {
          minValue: 0,
        },
        displayOptions: {
          show: {
            reconnectOnDisconnect: [true],
          },
        },
        description:
          "Maximum retryable reconnect failures within the configured window. Set 0 to disable this circuit breaker.",
      },
      {
        displayName: "Reconnect Initial Delay (MS)",
        name: "reconnectInitialDelayMs",
        type: "number",
        default: defaultReconnectInitialDelayMs,
        typeOptions: {
          minValue: 100,
        },
        displayOptions: {
          show: {
            reconnectOnDisconnect: [true],
          },
        },
        description: "Initial reconnect delay before jitter and exponential backoff",
      },
      {
        displayName: "Reconnect Max Delay (MS)",
        name: "reconnectMaxDelayMs",
        type: "number",
        default: defaultReconnectMaxDelayMs,
        typeOptions: {
          minValue: 100,
        },
        displayOptions: {
          show: {
            reconnectOnDisconnect: [true],
          },
        },
        description: "Maximum reconnect delay before jitter",
      },
      {
        displayName: "Max Inflight Events",
        name: "maxInflightEvents",
        type: "number",
        default: defaultMaxInflightSocketEvents,
        typeOptions: {
          minValue: 1,
        },
        description: "Maximum custom socket events processed concurrently",
      },
      {
        displayName: "Max Queue Size",
        name: "maxQueueSize",
        type: "number",
        default: defaultMaxQueuedSocketEvents,
        typeOptions: {
          minValue: 0,
        },
        description: "Maximum custom socket events queued while processors are busy",
      },
      {
        displayName: "Overflow Policy",
        name: "overflowPolicy",
        type: "options",
        default: "fail",
        options: [
          { name: "Drop Newest", value: "dropNewest" },
          { name: "Drop Oldest", value: "dropOldest" },
          { name: "Fail", value: "fail" },
        ],
        description: "Behavior when the custom socket event queue is full",
      },
      {
        displayName: "Require Payload Signature",
        name: "requirePayloadSignature",
        type: "boolean",
        default: false,
        description: "Whether inbound PayloadFrames must include a valid HMAC signature",
      },
      {
        displayName: "Require Payload Signature For",
        name: "requirePayloadSignatureFor",
        type: "options",
        default: "all",
        options: [
          { name: "Agent Profile Updated Only", value: "agentProfileUpdated" },
          { name: "All Event Sources", value: "all" },
          { name: "Custom Events Only", value: "customEvents" },
        ],
        displayOptions: {
          show: {
            requirePayloadSignature: [true],
          },
        },
        description:
          "Event sources that must include a PayloadFrame signature when signature enforcement is enabled",
      },
      {
        displayName: "Deduplicate Events",
        name: "deduplicateEvents",
        type: "boolean",
        default: false,
        displayOptions: {
          show: {
            eventSource: ["customEvents"],
          },
        },
        description:
          "Whether to ignore duplicate custom events with the same eventId during the TTL window",
      },
      {
        displayName: "Deduplication TTL (MS)",
        name: "deduplicationTtlMs",
        type: "number",
        default: defaultSocketEventDeduplicationTtlMs,
        typeOptions: {
          minValue: 0,
        },
        displayOptions: {
          show: {
            eventSource: ["customEvents"],
            deduplicateEvents: [true],
          },
        },
        description:
          "How long to remember emitted custom event IDs. Set 0 to disable deduplication.",
      },
      {
        displayName: "Manual Listen Timeout (MS)",
        name: "manualListenTimeoutMs",
        type: "number",
        default: defaultManualListenTimeoutMs,
        typeOptions: {
          minValue: 0,
        },
        description:
          "In manual mode, close the socket after this time. Set 0 to keep listening until stopped.",
      },
      {
        displayName: "Binary Property Prefix",
        name: "binaryPropertyPrefix",
        type: "string",
        default: defaultBinaryPropertyPrefix,
        displayOptions: {
          show: {
            eventSource: ["customEvents"],
          },
        },
        description: "Prefix for binary properties created from inline event attachments",
      },
      {
        displayName: "Include Plug Metadata",
        name: "includePlugMetadata",
        type: "boolean",
        default: true,
        description:
          "Whether to include the __plug object with socket and event metadata in output items",
      },
    ],
  };

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const credentials = await readCredentials(this);
    const requester = buildN8nHttpRequester(this);
    const sessionRunner = createExecutionSessionRunner(requester, credentials);
    const eventSource = this.getNodeParameter("eventSource", "customEvents") as
      | "customEvents"
      | "agentProfileUpdated";
    const eventNames =
      eventSource === "customEvents"
        ? readEventNames(this)
        : [clientAgentProfileUpdatedEventName];
    const ackTimeoutMs = normalizeInteger(
      this.getNodeParameter("ackTimeoutMs", defaultSocketEventAckTimeoutMs),
      defaultSocketEventAckTimeoutMs,
      1,
    );
    const manualListenTimeoutMs = normalizeInteger(
      this.getNodeParameter("manualListenTimeoutMs", defaultManualListenTimeoutMs),
      defaultManualListenTimeoutMs,
      0,
    );
    const binaryPropertyPrefix =
      String(
        this.getNodeParameter("binaryPropertyPrefix", defaultBinaryPropertyPrefix),
      ).trim() || defaultBinaryPropertyPrefix;
    const includeMetadata = this.getNodeParameter("includePlugMetadata", true) as boolean;
    const reconnectOnDisconnect = this.getNodeParameter(
      "reconnectOnDisconnect",
      true,
    ) as boolean;
    const normalizedMaxReconnectAttempts = normalizeInteger(
      this.getNodeParameter("maxReconnectAttempts", 0),
      0,
      0,
    );
    const reconnectInitialDelayMs = normalizeInteger(
      this.getNodeParameter("reconnectInitialDelayMs", defaultReconnectInitialDelayMs),
      defaultReconnectInitialDelayMs,
      100,
    );
    const reconnectMaxDelayMs = Math.max(
      reconnectInitialDelayMs,
      normalizeInteger(
        this.getNodeParameter("reconnectMaxDelayMs", defaultReconnectMaxDelayMs),
        defaultReconnectMaxDelayMs,
        100,
      ),
    );
    const reconnectFailureWindowMs = normalizeInteger(
      this.getNodeParameter("reconnectFailureWindowMs", defaultReconnectFailureWindowMs),
      defaultReconnectFailureWindowMs,
      1000,
    );
    const maxReconnectFailuresInWindow = normalizeInteger(
      this.getNodeParameter("maxReconnectFailuresInWindow", 0),
      0,
      0,
    );
    const maxInflightEvents = normalizeInteger(
      this.getNodeParameter("maxInflightEvents", defaultMaxInflightSocketEvents),
      defaultMaxInflightSocketEvents,
      1,
    );
    const maxQueueSize = normalizeInteger(
      this.getNodeParameter("maxQueueSize", defaultMaxQueuedSocketEvents),
      defaultMaxQueuedSocketEvents,
      0,
    );
    const overflowPolicyParameter = this.getNodeParameter(
      "overflowPolicy",
      "fail",
    ) as SocketEventOverflowPolicy;
    const overflowPolicy: SocketEventOverflowPolicy = [
      "fail",
      "dropNewest",
      "dropOldest",
    ].includes(overflowPolicyParameter)
      ? overflowPolicyParameter
      : "fail";
    const requirePayloadSignature = this.getNodeParameter(
      "requirePayloadSignature",
      false,
    ) as boolean;
    const requirePayloadSignatureForParameter = this.getNodeParameter(
      "requirePayloadSignatureFor",
      "all",
    ) as PayloadSignatureRequirement;
    const requirePayloadSignatureFor: PayloadSignatureRequirement = [
      "all",
      "customEvents",
      "agentProfileUpdated",
    ].includes(requirePayloadSignatureForParameter)
      ? requirePayloadSignatureForParameter
      : "all";
    const requirePayloadSignatureForSource =
      requirePayloadSignature &&
      (requirePayloadSignatureFor === "all" ||
        requirePayloadSignatureFor === eventSource);
    const deduplicateEvents = this.getNodeParameter(
      "deduplicateEvents",
      false,
    ) as boolean;
    const deduplicationTtlMs = normalizeInteger(
      this.getNodeParameter("deduplicationTtlMs", defaultSocketEventDeduplicationTtlMs),
      defaultSocketEventDeduplicationTtlMs,
      0,
    );

    let customEventSession: CustomSocketEventSession | undefined;
    let manualTimer: NodeJS.Timeout | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;
    let closed = false;
    let reconnecting = false;
    let reconnectAttempts = 0;
    let reconnectFailureTimes: number[] = [];

    const toPlugError = (error: unknown): PlugError =>
      error instanceof PlugError
        ? error
        : new PlugError("Plug socket custom event listener failed.", {
            code: "SOCKET_CUSTOM_EVENT_LISTENER_FAILED",
            technicalMessage: error instanceof Error ? error.message : undefined,
          });

    const clearReconnectTimer = (): void => {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
    };

    const eventQueue = createBackpressureQueue({
      maxInflightEvents,
      maxQueueSize,
      overflowPolicy,
      emitError: (error) => {
        this.emitError(error);
      },
      onDrop: (reason, metadata) => {
        plugLogger.warn("transport.socket.custom_event_trigger.dropped", {
          reason,
          queueSize: metadata.queueSize,
          maxQueueSize,
          maxInflightEvents,
        });
      },
    });

    const delay = async (durationMs: number): Promise<void> =>
      new Promise((resolve) => {
        setTimeout(resolve, durationMs);
      });

    const getReconnectDelayMs = (): number => {
      const baseDelay = reconnectInitialDelayMs;
      const maxDelay = reconnectMaxDelayMs;
      const exponentialDelay = Math.min(
        maxDelay,
        baseDelay * 2 ** Math.min(reconnectAttempts, 8),
      );
      const jitter = 0.8 + Math.random() * 0.4;
      return Math.max(100, Math.round(exponentialDelay * jitter));
    };

    const recordReconnectFailureAndIsCircuitOpen = (): boolean => {
      if (maxReconnectFailuresInWindow <= 0) {
        return false;
      }

      const now = Date.now();
      const cutoff = now - reconnectFailureWindowMs;
      reconnectFailureTimes = reconnectFailureTimes
        .filter((timestamp) => timestamp >= cutoff)
        .concat(now);

      return reconnectFailureTimes.length > maxReconnectFailuresInWindow;
    };

    const connectSocket = async (): Promise<void> => {
      await sessionRunner(async (session) => {
        if (closed) {
          return;
        }

        const socket = io(deriveSocketNamespaceUrl(credentials.baseUrl, "/consumers"), {
          autoConnect: false,
          reconnection: false,
          transports: ["websocket"],
          auth: {
            token: session.accessToken,
          },
        });
        const transport = new SocketIoCustomEventTransport(socket);

        const commonInput = {
          transport,
          ackTimeoutMs,
          payloadFrameSigning: resolvePayloadFrameSigning(credentials),
          reconnectAttempt: reconnectAttempts,
          requirePayloadSignature: requirePayloadSignatureForSource,
          onFatalError: (error: PlugError) => {
            void handleRuntimeError(error);
          },
        };

        customEventSession =
          eventSource === "agentProfileUpdated"
            ? await startAgentProfileUpdatedSession({
                ...commonInput,
                onEvent: (event: AgentProfileUpdatedPayload, metadata) => {
                  eventQueue.enqueue(async () => {
                    if (closed) {
                      return;
                    }

                    const item = buildAgentProfileUpdatedItem(
                      event,
                      includeMetadata,
                      metadata,
                      eventQueue.getStats(),
                    );
                    if (closed) {
                      return;
                    }

                    this.emit([[item]]);
                  });
                },
              })
            : await startCustomSocketEventSession({
                ...commonInput,
                eventNames,
                deduplicateEventIdsTtlMs:
                  deduplicateEvents && deduplicationTtlMs > 0
                    ? deduplicationTtlMs
                    : undefined,
                onEvent: (event, metadata: SocketEventRuntimeMetadata) => {
                  eventQueue.enqueue(async () => {
                    if (closed) {
                      return;
                    }

                    const item = await buildTriggerItem(
                      this,
                      event,
                      binaryPropertyPrefix,
                      includeMetadata,
                      metadata,
                      eventQueue.getStats(),
                    );
                    if (closed) {
                      return;
                    }

                    this.emit([[item]]);
                  });
                },
              });
      });

      reconnectAttempts = 0;
      reconnectFailureTimes = [];
    };

    const connectSocketWithRetry = async (): Promise<void> => {
      for (;;) {
        try {
          await connectSocket();
          return;
        } catch (error: unknown) {
          const plugError = toPlugError(error);
          if (
            closed ||
            !reconnectOnDisconnect ||
            !plugError.retryable ||
            plugError.authRelated ||
            (normalizedMaxReconnectAttempts > 0 &&
              reconnectAttempts >= normalizedMaxReconnectAttempts)
          ) {
            throw plugError;
          }

          if (recordReconnectFailureAndIsCircuitOpen()) {
            throw createReconnectCircuitOpenError(plugError.message);
          }

          reconnectAttempts += 1;
          await delay(getReconnectDelayMs());
        }
      }
    };

    const scheduleReconnect = (error: PlugError): void => {
      if (closed || !reconnectOnDisconnect || !error.retryable || error.authRelated) {
        this.emitError(error);
        return;
      }

      if (recordReconnectFailureAndIsCircuitOpen()) {
        this.emitError(createReconnectCircuitOpenError(error.message));
        return;
      }

      if (
        normalizedMaxReconnectAttempts > 0 &&
        reconnectAttempts >= normalizedMaxReconnectAttempts
      ) {
        this.emitError(
          new PlugError("Plug socket reconnect attempts were exhausted.", {
            code: "SOCKET_RECONNECT_EXHAUSTED",
            description:
              "Increase Max Reconnect Attempts or restart the workflow after checking the Plug server.",
            retryable: true,
            technicalMessage: error.message,
          }),
        );
        return;
      }

      clearReconnectTimer();
      reconnectTimer = setTimeout(() => {
        reconnectTimer = undefined;
        reconnectAttempts += 1;
        reconnecting = false;
        connectSocketWithRetry().catch((connectError: unknown) => {
          void handleRuntimeError(toPlugError(connectError));
        });
      }, getReconnectDelayMs());
    };

    const handleRuntimeError = async (error: PlugError): Promise<void> => {
      if (closed || reconnecting) {
        return;
      }

      reconnecting = true;
      try {
        await customEventSession?.close({ unsubscribe: false });
      } catch {
        // The socket is already unhealthy; reconnect handling below is the recovery path.
      } finally {
        customEventSession = undefined;
      }

      scheduleReconnect(error);
    };

    await connectSocketWithRetry();

    const closeFunction = async (): Promise<void> => {
      closed = true;
      clearReconnectTimer();
      eventQueue.close();
      if (manualTimer) {
        clearTimeout(manualTimer);
        manualTimer = undefined;
      }
      await customEventSession?.close();
      customEventSession = undefined;
    };

    if (this.getMode() === "manual" && manualListenTimeoutMs > 0) {
      manualTimer = setTimeout(() => {
        void closeFunction();
      }, manualListenTimeoutMs);
    }

    return {
      closeFunction,
    };
  }
}
