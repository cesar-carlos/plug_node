import { Buffer } from "node:buffer";

import type {
  IBinaryKeyData,
  IDataObject,
  INodeExecutionData,
  ITriggerFunctions,
} from "n8n-workflow";

import {
  DEFAULT_BASE_URL,
  type PlugCredentialDefaults,
} from "../../generated/shared/contracts/api";
import {
  clientAgentProfileUpdatedEventName,
  toAttachmentMetadata,
  type AgentProfileUpdatedPayload,
  type CustomSocketEventFramePayload,
  type SocketEventRuntimeMetadata,
} from "../../generated/shared/contracts/custom-socket-events";
import type { BackpressureSnapshot } from "./triggerBackpressureQueue";

import { plugSocketEventTriggerCredentialName } from "../../generated/shared/n8n/plugSocketEventTriggerDescription";

export const readTriggerCredentials = async (
  context: ITriggerFunctions,
): Promise<PlugCredentialDefaults> => {
  const rawCredentials = await context.getCredentials(
    plugSocketEventTriggerCredentialName,
  );
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

export const resolveTriggerPayloadFrameSigning = (
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

export interface SubscriptionRefreshSnapshot {
  readonly refreshCount: number;
  readonly lastRefreshedAt?: string;
}

export const buildTriggerItem = async (
  context: ITriggerFunctions,
  event: CustomSocketEventFramePayload,
  binaryPropertyPrefix: string,
  includeMetadata: boolean,
  metadata: SocketEventRuntimeMetadata,
  backpressure: BackpressureSnapshot,
  subscriptionRefresh: SubscriptionRefreshSnapshot,
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
            subscriptionRefreshCount: subscriptionRefresh.refreshCount,
            lastSubscriptionRefreshAt: subscriptionRefresh.lastRefreshedAt,
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

export const buildAgentProfileUpdatedItem = (
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
