import type { IExecuteFunctions } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { toNodeFacingError } from "../output/errorOutput";

import { PlugValidationError } from "../contracts/errors";
export { serializeErrorForContinueOnFail } from "../output/errorOutput";
import type {
  PayloadFrameCompression,
  PlugCredentialDefaults,
  PlugSession,
} from "../contracts/api";
import type {
  CustomSocketEventAttachment,
  CustomSocketEventFramePayload,
  PublishCustomSocketEventResponse,
  SocketEventRuntimeMetadata,
} from "../contracts/custom-socket-events";
import type { HtmlToPdfRenderer } from "../tools/pdf";
import { parseJsonText } from "../utils/json";
import { toOptionalString } from "./plugExecutionParameters";

export interface PlugToolsPdfExecutionConfig {
  readonly nodeDisplayName: string;
  readonly renderer?: HtmlToPdfRenderer;
}

export interface PlugToolsBarcodeExecutionConfig {
  readonly nodeDisplayName: string;
}

export interface PlugToolsSocketEventPublishInput {
  readonly session: PlugSession<PlugCredentialDefaults>;
  readonly eventName: string;
  readonly payload: unknown;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly idempotencyKey?: string;
  readonly attachments: readonly CustomSocketEventAttachment[];
  readonly timeoutMs: number;
  readonly payloadFrameSigning?:
    | {
        readonly key?: string;
        readonly keyId?: string;
      }
    | undefined;
}

export interface PlugToolsSocketEventPublisher {
  (input: PlugToolsSocketEventPublishInput): Promise<PublishCustomSocketEventResponse>;
}

export interface PlugToolsSocketEventListenInput {
  readonly session: PlugSession<PlugCredentialDefaults>;
  readonly eventName: string;
  readonly listenTimeoutMs: number;
  readonly ackTimeoutMs: number;
  readonly payloadFrameSigning?:
    | {
        readonly key?: string;
        readonly keyId?: string;
      }
    | undefined;
  readonly requirePayloadSignature: boolean;
}

export interface PlugToolsSocketEventListenResult {
  readonly event: CustomSocketEventFramePayload;
  readonly metadata: SocketEventRuntimeMetadata;
}

export interface PlugToolsSocketEventListener {
  (input: PlugToolsSocketEventListenInput): Promise<PlugToolsSocketEventListenResult>;
}

export interface PlugToolsExecutionConfig {
  readonly credentialName?: string;
  readonly nodeDisplayName: string;
  readonly renderer?: HtmlToPdfRenderer;
  readonly socketEventPublisher?: PlugToolsSocketEventPublisher;
  readonly socketEventListener?: PlugToolsSocketEventListener;
}

export { emptyInputItem } from "./plugItemExecution";
export { toCollection, toOptionalString } from "./plugExecutionParameters";

export const normalizeOutputBinaryProperty = (value: unknown): string => {
  const propertyName = toOptionalString(value) ?? "data";
  if (!/^[A-Za-z0-9_-]+$/.test(propertyName)) {
    throw new PlugValidationError(
      "Output Binary Property may contain only letters, numbers, underscores, and hyphens",
    );
  }

  return propertyName;
};

export const normalizeOutputJsonProperty = (
  value: unknown,
  fallback: string,
  label: string,
): string => {
  const propertyName = toOptionalString(value) ?? fallback;
  if (!/^[A-Za-z0-9_-]+$/.test(propertyName)) {
    throw new PlugValidationError(
      `${label} may contain only letters, numbers, underscores, and hyphens`,
    );
  }

  return propertyName;
};

export const normalizePositiveIntegerLimit = (
  value: unknown,
  fallback: number,
  label: string,
): number => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new PlugValidationError(`${label} must be a positive integer`);
  }

  return numberValue;
};

export const assertBufferSize = (
  buffer: Buffer,
  maxSizeBytes: number,
  label: string,
): void => {
  if (buffer.length > maxSizeBytes) {
    throw new PlugValidationError(
      `${label} size must be less than or equal to ${maxSizeBytes} bytes`,
    );
  }
};

export const parseAdvancedOptions = (value: unknown): unknown => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") {
    return undefined;
  }

  return parseJsonText(text, "Advanced Options JSON");
};

export const now = (): number => Date.now();

export const toNodeOperationError = (
  context: IExecuteFunctions,
  error: unknown,
  nodeDisplayName: string,
  itemIndex: number,
): NodeOperationError => {
  return new NodeOperationError(context.getNode(), toNodeFacingError(error), {
    itemIndex,
  });
};
