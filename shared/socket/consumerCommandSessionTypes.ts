import type {
  BridgeCommand,
  PayloadFrameCompression,
  PlugResponseMode,
  PlugSession,
} from "../contracts/api";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";

export interface ConsumerSocketTransport {
  readonly connected: boolean;
  connect(): void;
  disconnect(): void;
  on(event: string, handler: (payload: unknown) => void): void;
  off(event: string, handler: (payload: unknown) => void): void;
  emit(event: string, payload?: unknown): void;
}

export interface ExecuteConsumerCommandInput {
  readonly transport: ConsumerSocketTransport;
  readonly session: PlugSession;
  readonly agentId: string;
  readonly command: BridgeCommand;
  readonly timeoutMs?: number;
  readonly payloadFrameCompression?: PayloadFrameCompression;
  readonly responseMode: PlugResponseMode;
  readonly payloadFrameSigning?: PayloadFrameSigningOptions;
  readonly bufferLimits?: {
    readonly maxBufferedChunkItems?: number;
    readonly maxBufferedRows?: number;
    readonly maxBufferedBytes?: number;
  };
  readonly streamPullWindowSize?: number;
}
