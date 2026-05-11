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
  defaultBinaryPropertyPrefix,
  defaultManualListenTimeoutMs,
  defaultSocketEventAckTimeoutMs,
  toAttachmentMetadata,
  type CustomSocketEventFramePayload,
} from "../../generated/shared/contracts/custom-socket-events";
import { buildN8nHttpRequester } from "../../generated/shared/n8n/httpRequester";
import {
  startCustomSocketEventSession,
  type CustomSocketEventSession,
  type CustomSocketEventTransport,
} from "../../generated/shared/socket/customSocketEventSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";

const credentialName = "plugDatabaseAdvancedApi";
const defaultReconnectInitialDelayMs = 1000;
const defaultReconnectMaxDelayMs = 30_000;

class SocketIoCustomEventTransport implements CustomSocketEventTransport {
  constructor(private readonly socket: Socket) {}

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

const buildTriggerItem = async (
  context: ITriggerFunctions,
  event: CustomSocketEventFramePayload,
  binaryPropertyPrefix: string,
  includeMetadata: boolean,
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
          },
        }
      : {}),
  };

  return {
    json,
    ...(Object.keys(binary).length > 0 ? { binary } : {}),
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
        displayName: "Event Names",
        name: "eventNames",
        type: "fixedCollection",
        placeholder: "Add event",
        default: {
          values: [{ eventName: "client:custom.status.changed" }],
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
        description: "Time to wait for subscribe and unsubscribe acknowledgements",
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
    const eventNames = readEventNames(this);
    const ackTimeoutMs = this.getNodeParameter(
      "ackTimeoutMs",
      defaultSocketEventAckTimeoutMs,
    ) as number;
    const manualListenTimeoutMs = this.getNodeParameter(
      "manualListenTimeoutMs",
      defaultManualListenTimeoutMs,
    ) as number;
    const binaryPropertyPrefix =
      String(
        this.getNodeParameter("binaryPropertyPrefix", defaultBinaryPropertyPrefix),
      ).trim() || defaultBinaryPropertyPrefix;
    const includeMetadata = this.getNodeParameter("includePlugMetadata", true) as boolean;
    const reconnectOnDisconnect = this.getNodeParameter(
      "reconnectOnDisconnect",
      true,
    ) as boolean;
    const maxReconnectAttempts = this.getNodeParameter(
      "maxReconnectAttempts",
      0,
    ) as number;
    const reconnectInitialDelayMs = this.getNodeParameter(
      "reconnectInitialDelayMs",
      defaultReconnectInitialDelayMs,
    ) as number;
    const reconnectMaxDelayMs = this.getNodeParameter(
      "reconnectMaxDelayMs",
      defaultReconnectMaxDelayMs,
    ) as number;
    const normalizedMaxReconnectAttempts =
      Number.isFinite(maxReconnectAttempts) && maxReconnectAttempts > 0
        ? Math.floor(maxReconnectAttempts)
        : 0;

    let customEventSession: CustomSocketEventSession | undefined;
    let manualTimer: NodeJS.Timeout | undefined;
    let reconnectTimer: NodeJS.Timeout | undefined;
    let closed = false;
    let reconnecting = false;
    let reconnectAttempts = 0;

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

    const getReconnectDelayMs = (): number => {
      const baseDelay =
        Number.isFinite(reconnectInitialDelayMs) && reconnectInitialDelayMs >= 100
          ? reconnectInitialDelayMs
          : defaultReconnectInitialDelayMs;
      const maxDelay =
        Number.isFinite(reconnectMaxDelayMs) && reconnectMaxDelayMs >= baseDelay
          ? reconnectMaxDelayMs
          : Math.max(baseDelay, defaultReconnectMaxDelayMs);
      const exponentialDelay = Math.min(
        maxDelay,
        baseDelay * 2 ** Math.min(reconnectAttempts, 8),
      );
      const jitter = 0.8 + Math.random() * 0.4;
      return Math.max(100, Math.round(exponentialDelay * jitter));
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

        customEventSession = await startCustomSocketEventSession({
          transport,
          eventNames,
          ackTimeoutMs,
          payloadFrameSigning: resolvePayloadFrameSigning(credentials),
          onFatalError: (error) => {
            void handleRuntimeError(error);
          },
          onEvent: async (event) => {
            const item = await buildTriggerItem(
              this,
              event,
              binaryPropertyPrefix,
              includeMetadata,
            );
            this.emit([[item]]);
          },
        });
      });

      reconnectAttempts = 0;
    };

    const scheduleReconnect = (error: PlugError): void => {
      if (closed || !reconnectOnDisconnect || !error.retryable || error.authRelated) {
        this.emitError(error);
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
        connectSocket().catch((connectError: unknown) => {
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

    await connectSocket();

    const closeFunction = async (): Promise<void> => {
      closed = true;
      clearReconnectTimer();
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
