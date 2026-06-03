import { io } from "socket.io-client";
import type {
  INodeType,
  INodeTypeDescription,
  ITriggerFunctions,
  ITriggerResponse,
} from "n8n-workflow";

import { createExecutionSessionRunner } from "../../generated/shared/auth/session";
import { PlugError } from "../../generated/shared/contracts/errors";
import {
  clientAgentProfileUpdatedEventName,
  defaultBinaryPropertyPrefix,
  defaultMaxInflightSocketEvents,
  defaultMaxQueuedSocketEvents,
  defaultManualListenTimeoutMs,
  defaultSocketEventAckTimeoutMs,
  defaultSocketEventDeduplicationTtlMs,
  type AgentProfileUpdatedPayload,
  type SocketEventOverflowPolicy,
  type SocketEventRuntimeMetadata,
} from "../../generated/shared/contracts/custom-socket-events";
import { plugLogger } from "../../generated/shared/logging/plugLogger";
import { buildN8nHttpRequester } from "../../generated/shared/n8n/httpRequester";
import {
  startAgentProfileUpdatedSession,
  startCustomSocketEventSession,
  type CustomSocketEventSession,
} from "../../generated/shared/socket/customSocketEventSession";
import { deriveSocketNamespaceUrl } from "../../generated/shared/utils/url";
import { plugDatabaseSocketEventTriggerDescription } from "../../generated/shared/n8n/plugSocketEventTriggerDescription";
import { SocketIoCustomEventTransport } from "./socketIoTransport";
import {
  createBackpressureQueue,
  defaultBackpressureStatsLogIntervalMs,
} from "./triggerBackpressureQueue";
import {
  buildAgentProfileUpdatedItem,
  buildTriggerItem,
  readTriggerCredentials,
  resolveTriggerPayloadFrameSigning,
} from "./triggerItemBuilders";
import {
  createReconnectCircuitOpenError,
  defaultReconnectFailureWindowMs,
  defaultReconnectInitialDelayMs,
  defaultReconnectMaxDelayMs,
  normalizeTriggerInteger,
  readTriggerEventNames,
  type PayloadSignatureRequirement,
} from "./triggerHelpers";

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- Triggers are event sources, not AI-agent tools.
export class PlugDatabaseSocketEventTrigger implements INodeType {
  description: INodeTypeDescription = {
    ...plugDatabaseSocketEventTriggerDescription,
    icon: {
      light: "file:plugDatabaseV2.svg",
      dark: "file:plugDatabaseV2.dark.svg",
    },
    subtitle: '={{$parameter["eventNames"]?.values?.[0]?.eventName}}',
  };

  async trigger(this: ITriggerFunctions): Promise<ITriggerResponse> {
    const credentials = await readTriggerCredentials(this);
    const requester = buildN8nHttpRequester(this);
    const sessionRunner = createExecutionSessionRunner(requester, credentials);
    const eventSource = this.getNodeParameter("eventSource", "customEvents") as
      | "customEvents"
      | "agentProfileUpdated";
    const eventNames =
      eventSource === "customEvents"
        ? readTriggerEventNames(this)
        : [clientAgentProfileUpdatedEventName];
    const ackTimeoutMs = normalizeTriggerInteger(
      this.getNodeParameter("ackTimeoutMs", defaultSocketEventAckTimeoutMs),
      defaultSocketEventAckTimeoutMs,
      1,
    );
    const manualListenTimeoutMs = normalizeTriggerInteger(
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
    const normalizedMaxReconnectAttempts = normalizeTriggerInteger(
      this.getNodeParameter("maxReconnectAttempts", 0),
      0,
      0,
    );
    const reconnectInitialDelayMs = normalizeTriggerInteger(
      this.getNodeParameter("reconnectInitialDelayMs", defaultReconnectInitialDelayMs),
      defaultReconnectInitialDelayMs,
      100,
    );
    const reconnectMaxDelayMs = Math.max(
      reconnectInitialDelayMs,
      normalizeTriggerInteger(
        this.getNodeParameter("reconnectMaxDelayMs", defaultReconnectMaxDelayMs),
        defaultReconnectMaxDelayMs,
        100,
      ),
    );
    const reconnectFailureWindowMs = normalizeTriggerInteger(
      this.getNodeParameter("reconnectFailureWindowMs", defaultReconnectFailureWindowMs),
      defaultReconnectFailureWindowMs,
      1000,
    );
    const maxReconnectFailuresInWindow = normalizeTriggerInteger(
      this.getNodeParameter("maxReconnectFailuresInWindow", 0),
      0,
      0,
    );
    const maxInflightEvents = normalizeTriggerInteger(
      this.getNodeParameter("maxInflightEvents", defaultMaxInflightSocketEvents),
      defaultMaxInflightSocketEvents,
      1,
    );
    const maxQueueSize = normalizeTriggerInteger(
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
    const payloadFrameSigning = resolveTriggerPayloadFrameSigning(credentials);
    const requirePayloadSignatureForCustomEvents =
      requirePayloadSignature &&
      (requirePayloadSignatureFor === "all" ||
        requirePayloadSignatureFor === "customEvents");
    const requirePayloadSignatureForAgentProfileUpdated =
      requirePayloadSignature &&
      (requirePayloadSignatureFor === "all" ||
        requirePayloadSignatureFor === "agentProfileUpdated");
    const deduplicateEvents = this.getNodeParameter(
      "deduplicateEvents",
      false,
    ) as boolean;
    const deduplicationTtlMs = normalizeTriggerInteger(
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
    const subscriptionRefreshCount = 0;
    const lastSubscriptionRefreshAt: string | undefined = undefined;

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
      statsLogIntervalMs: defaultBackpressureStatsLogIntervalMs,
      onDrop: (reason, metadata) => {
        plugLogger.warn("transport.socket.custom_event_trigger.dropped", {
          reason,
          queueSize: metadata.queueSize,
          maxQueueSize,
          maxInflightEvents,
        });
      },
      onStats: (snapshot, metadata) => {
        plugLogger.info("transport.socket.custom_event_trigger.backpressure_stats", {
          reason: metadata.reason,
          maxQueueSize,
          maxInflightEvents,
          ...snapshot,
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
          payloadFrameSigning,
          reconnectAttempt: reconnectAttempts,
          requirePayloadSignature:
            eventSource === "customEvents"
              ? requirePayloadSignatureForCustomEvents
              : requirePayloadSignatureForAgentProfileUpdated,
          scheduleEvent: (task: () => Promise<void>) => {
            eventQueue.enqueue(task);
          },
          onFatalError: (error: PlugError) => {
            void handleRuntimeError(error);
          },
        };

        customEventSession =
          eventSource === "agentProfileUpdated"
            ? await startAgentProfileUpdatedSession({
                ...commonInput,
                onEvent: async (event: AgentProfileUpdatedPayload, metadata) => {
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
                },
              })
            : await startCustomSocketEventSession({
                ...commonInput,
                eventNames,
                deduplicateEventIdsTtlMs:
                  deduplicateEvents && deduplicationTtlMs > 0
                    ? deduplicationTtlMs
                    : undefined,
                onEvent: async (event, metadata: SocketEventRuntimeMetadata) => {
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
                    {
                      refreshCount: subscriptionRefreshCount,
                      lastRefreshedAt: lastSubscriptionRefreshAt,
                    },
                  );
                  if (closed) {
                    return;
                  }

                  this.emit([[item]]);
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
      if (closed || !reconnectOnDisconnect || !error.retryable) {
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
      } catch (closeError: unknown) {
        plugLogger.debug("trigger.socket.close_failed_during_reconnect", {
          message: closeError instanceof Error ? closeError.message : String(closeError),
        });
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
