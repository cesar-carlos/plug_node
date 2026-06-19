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
} from "./plugToolsCommon";
import type { PayloadFrameSigningOptions } from "../contracts/payload-frame";

export interface PlugSocketExecutor {
  (input: {
    readonly session: import("../contracts/api").PlugSession<PlugCredentialDefaults>;
    readonly agentId: string;
    readonly command: BridgeCommand;
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
    readonly fastPath?: boolean;
    readonly requestServerTimings?: boolean;
    readonly agentRecommendedStreamPullWindowSize?: number;
    readonly agentMaxStreamPullWindowSize?: number;
    readonly reusedConversationId?: string;
    readonly skipConversationEnd?: boolean;
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
