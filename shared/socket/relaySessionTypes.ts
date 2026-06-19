import type {
  PayloadFrameCompression,
  PlugResponseMode,
  PlugSession,
  RpcSingleCommand,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";

export interface RelaySocketTransport {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface ExecuteRelayCommandInput {
  readonly transport: RelaySocketTransport;
  readonly session: PlugSession;
  readonly agentId: string;
  readonly command: RpcSingleCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly responseMode: PlugResponseMode;
  readonly bufferLimits?: {
    readonly maxBufferedChunkItems?: number;
    readonly maxBufferedRows?: number;
    readonly maxBufferedBytes?: number;
  };
  readonly streamPullWindowSize?: number;
  readonly agentRecommendedStreamPullWindowSize?: number;
  readonly agentMaxStreamPullWindowSize?: number;
  readonly fastPath?: boolean;
  readonly requestServerTimings?: boolean;
  /** When true, the caller owns connect/disconnect; only conversation scope is closed per command. */
  readonly managedTransport?: boolean;
  /** Reuse an existing relay conversation instead of starting a new one. */
  readonly reusedConversationId?: string;
  /** When true, skip relay:conversation.end after the command (caller owns lifecycle). */
  readonly skipConversationEnd?: boolean;
}
