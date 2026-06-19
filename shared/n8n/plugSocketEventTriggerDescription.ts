import type { INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import {
  defaultBinaryPropertyPrefix,
  defaultConsumerIdleKeepaliveIntervalMs,
  defaultManualListenTimeoutMs,
  defaultMaxInflightSocketEvents,
  defaultMaxQueuedSocketEvents,
  defaultSocketEventAckTimeoutMs,
  defaultSocketEventDeduplicationTtlMs,
  maxConsumerIdleKeepaliveIntervalMs,
} from "../contracts/custom-socket-events";

export const plugSocketEventTriggerCredentialName = "plugDatabaseAccountApi";

const defaultReconnectInitialDelayMs = 1000;
const defaultReconnectMaxDelayMs = 30_000;
const defaultReconnectFailureWindowMs = 300_000;

export const plugDatabaseSocketEventTriggerDescription: INodeTypeDescription = {
  displayName: "Plug Database Socket Event Trigger",
  name: "plugDatabaseSocketEventTrigger",
  icon: {
    light: "file:plugDatabaseV2.svg",
    dark: "file:plugDatabaseV2.dark.svg",
  },
  group: ["trigger"],
  version: 1,
  subtitle: '={{$parameter["eventNames"]?.values?.[0]?.eventName}}',
  description: "Starts a workflow when a Plug Database socket event is received.",
  eventTriggerDescription:
    "Emits one item when a subscribed Plug Database socket event is received.",
  activationMessage: "Listening for Plug Database socket events.",
  triggerPanel: {
    header: "Listen for Plug Database socket events",
    executionsHelp: {
      active: "Waiting for matching socket events.",
      inactive: "Activate the workflow to keep the socket listener online.",
    },
    activationHint: {
      active: "Socket listener is active.",
      inactive: "Activate this workflow to start listening.",
    },
  },
  defaults: {
    name: "Plug Database Socket Event Trigger",
  },
  codex: {
    alias: [
      "Plug Database Advanced Trigger",
      "Advanced Trigger",
      "Plug Socket Event Trigger",
      "Socket Event",
    ],
  },
  inputs: [],
  outputs: [NodeConnectionTypes.Main],
  credentials: [
    {
      name: plugSocketEventTriggerCredentialName,
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
      displayName: "Consumer Idle Keepalive (MS)",
      name: "consumerIdleKeepaliveIntervalMs",
      type: "number",
      default: defaultConsumerIdleKeepaliveIntervalMs,
      typeOptions: {
        minValue: 0,
        maxValue: maxConsumerIdleKeepaliveIntervalMs,
      },
      description:
        "Emit lightweight inbound socket activity on this interval to avoid the hub consumer idle timeout (default 30 min). Set 0 to disable. Recommended: 1,200,000 (20 min).",
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
