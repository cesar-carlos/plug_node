import type {
  BridgeCommand,
  PayloadFrameCompression,
  PlugCommandTransportResult,
  PlugCredentialDefaults,
  PlugResponseMode,
} from "../contracts/api";
import type {
  PlugToolsSocketEventListener,
  PlugToolsSocketEventPublisher,
} from "./plugToolsExecution";

export interface PlugSocketExecutor {
  (input: {
    readonly session: import("../contracts/api").PlugSession<PlugCredentialDefaults>;
    readonly agentId: string;
    readonly command: BridgeCommand;
    readonly timeoutMs?: number;
    readonly payloadFrameCompression?: PayloadFrameCompression;
    readonly payloadFrameSigning?: {
      readonly key?: string;
      readonly keyId?: string;
    };
    readonly responseMode: PlugResponseMode;
    readonly bufferLimits?: {
      readonly maxBufferedChunkItems?: number;
      readonly maxBufferedRows?: number;
      readonly maxBufferedBytes?: number;
    };
    readonly streamPullWindowSize?: number;
  }): Promise<PlugCommandTransportResult>;
}

export interface PlugClientNodeExecutionConfig {
  readonly supportsSocket: boolean;
  readonly credentialName?: string;
  readonly nodeDisplayName?: string;
  readonly socketExecutor?: PlugSocketExecutor;
  readonly legacySocketExecutor?: PlugSocketExecutor;
  readonly toolSocketEventPublisher?: PlugToolsSocketEventPublisher;
  readonly socketEventListener?: PlugToolsSocketEventListener;
}
