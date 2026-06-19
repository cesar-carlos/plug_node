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
  defaultConsumerIdleKeepaliveIntervalMs,
  maxConsumerIdleKeepaliveIntervalMs,
  minConsumerIdleKeepaliveIntervalMs,
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
import { plugDatabaseSocketEventTriggerDescription } from "../../generated/shared/n8n/plugSocketEventTriggerDescription";
import { createTriggerSocketTransport } from "../PlugDatabase/socketIoTransport";
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
  defaultReconnectFailureWindowMs,
  defaultReconnectInitialDelayMs,
  defaultReconnectMaxDelayMs,
  normalizeTriggerInteger,
  readTriggerEventNames,
  type PayloadSignatureRequirement,
} from "./triggerHelpers";
import { TriggerReconnectManager } from "./triggerReconnectManager";

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
    const consumerIdleKeepaliveIntervalMs = (() => {
      const raw = this.getNodeParameter(
        "consumerIdleKeepaliveIntervalMs",
        defaultConsumerIdleKeepaliveIntervalMs,
      );
      const normalized = normalizeTriggerInteger(
        raw,
        defaultConsumerIdleKeepaliveIntervalMs,
        0,
      );
      if (normalized === 0) {
        return 0;
      }

      return Math.min(
        maxConsumerIdleKeepaliveIntervalMs,
        Math.max(minConsumerIdleKeepaliveIntervalMs, normalized),
      );
    })();
    let customEventSession: CustomSocketEventSession | undefined;
    let manualTimer: NodeJS.Timeout | undefined;
    let closed = false;
    const subscriptionRefreshCount = 0;
    const lastSubscriptionRefreshAt: string | undefined = undefined;

    const reconnectManager = new TriggerReconnectManager({
      reconnectOnDisconnect,
      maxReconnectAttempts: normalizedMaxReconnectAttempts,
      reconnectInitialDelayMs,
      reconnectMaxDelayMs,
      reconnectFailureWindowMs,
      maxReconnectFailuresInWindow,
      onFatalError: (error) => {
        this.emitError(error);
      },
    });

    const clearReconnectTimer = (): void => {
      reconnectManager.clearReconnectTimer();
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

    const connectSocket = async (): Promise<void> => {
      await sessionRunner(async (session) => {
        if (closed) {
          return;
        }

        const transport = createTriggerSocketTransport({
          baseUrl: credentials.baseUrl,
          accessToken: session.accessToken,
        });

        const commonInput = {
          transport,
          ackTimeoutMs,
          payloadFrameSigning,
          reconnectAttempt: reconnectManager.getReconnectAttempts(),
          consumerIdleKeepaliveIntervalMs,
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
                agentId: credentials.agentId,
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
    };

    const handleRuntimeError = async (error: PlugError): Promise<void> => {
      await reconnectManager.handleRuntimeError(
        error,
        () => reconnectManager.connectWithRetry(connectSocket),
        async () => {
          try {
            await customEventSession?.close({ unsubscribe: false });
          } catch (closeError: unknown) {
            plugLogger.debug("trigger.socket.close_failed_during_reconnect", {
              message:
                closeError instanceof Error ? closeError.message : String(closeError),
            });
          } finally {
            customEventSession = undefined;
          }
        },
      );
    };

    await reconnectManager.connectWithRetry(connectSocket);

    const closeFunction = async (): Promise<void> => {
      closed = true;
      reconnectManager.markClosed();
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
