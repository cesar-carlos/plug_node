import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";
import type {
  AgentProfileUpdatedPayload,
  CustomSocketEventFramePayload,
  SocketEventRuntimeMetadata,
} from "../contracts/custom-socket-events";
import type { PlugError } from "../contracts/errors";

export interface CustomSocketEventTransport {
  readonly id?: string;
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface StartCustomSocketEventSessionInput {
  readonly transport: CustomSocketEventTransport;
  readonly eventNames: readonly string[];
  readonly ackTimeoutMs?: number;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly reconnectAttempt?: number;
  readonly requirePayloadSignature?: boolean;
  readonly deduplicateEventIdsTtlMs?: number;
  readonly consumerIdleKeepaliveIntervalMs?: number;
  readonly scheduleEvent?: (task: () => Promise<void>) => void;
  readonly onEvent: (
    event: CustomSocketEventFramePayload,
    metadata: SocketEventRuntimeMetadata,
  ) => void | Promise<void>;
  readonly onFatalError: (error: PlugError) => void;
}

export interface StartAgentProfileUpdatedSessionInput {
  readonly transport: CustomSocketEventTransport;
  readonly ackTimeoutMs?: number;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly reconnectAttempt?: number;
  readonly requirePayloadSignature?: boolean;
  readonly consumerIdleKeepaliveIntervalMs?: number;
  readonly agentId?: string;
  readonly scheduleEvent?: (task: () => Promise<void>) => void;
  readonly onEvent: (
    event: AgentProfileUpdatedPayload,
    metadata: SocketEventRuntimeMetadata,
  ) => void | Promise<void>;
  readonly onFatalError: (error: PlugError) => void;
}

export interface CustomSocketEventSession {
  readonly eventNames: readonly string[];
  close(options?: { readonly unsubscribe?: boolean }): Promise<void>;
}

export interface WaitForCustomSocketEventInput {
  readonly transport: CustomSocketEventTransport;
  readonly eventName: string;
  readonly ackTimeoutMs?: number;
  readonly listenTimeoutMs?: number;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly requirePayloadSignature?: boolean;
}

export interface WaitForCustomSocketEventResult {
  readonly event: CustomSocketEventFramePayload;
  readonly metadata: SocketEventRuntimeMetadata;
}
