import type {
  NormalizedAgentRpcResponse,
  NormalizedRpcItem,
  PlugCommandTransportResult,
  SocketCommandRuntimeMetrics,
  SocketTransportResult,
} from "../../generated/shared/contracts/api";
import { PlugValidationError } from "../../generated/shared/contracts/errors";
import type { PlugSocketExecutor } from "../../generated/shared/n8n/plugClientExecution";
import {
  executeRelayBatchCommand,
  type RelayBatchCommandItemResult,
} from "../../generated/shared/socket/relayBatchSession";
import {
  executeRelayCommand,
  type RelaySocketTransport,
} from "../../generated/shared/socket/relaySession";
import { relayConversationEndEvent } from "../../generated/shared/socket/relaySessionConstants";
import {
  extractMaxStreamPullWindowSize,
  extractRecommendedStreamPullWindowSize,
} from "../../generated/shared/socket/streamPullWindowPolicy";
import { createManagedSocketIoTransport } from "./managedSocketIoTransport";

interface AgentRelaySessionState {
  conversationId?: string;
  agentRecommendedStreamPullWindowSize?: number;
  agentMaxStreamPullWindowSize?: number;
}

const buildMergedBatchMetrics = (
  serverTimings:
    | import("../../generated/shared/contracts/api").PlugServerTimings
    | undefined,
): SocketCommandRuntimeMetrics | undefined =>
  serverTimings
    ? {
        ignoredCommandResponses: 0,
        ignoredStreamChunks: 0,
        ignoredStreamCompletes: 0,
        ignoredStreamPullResponses: 0,
        streamPullRequests: 0,
        streamChunks: 0,
        bufferedBytes: 0,
        bufferedRows: 0,
        serverTimings,
      }
    : undefined;

const assertSocketTransportResult = (
  result: PlugCommandTransportResult,
): SocketTransportResult => {
  if (result.channel !== "socket" || result.notification) {
    throw new PlugValidationError(
      "Relay batch item response must be a socket transport result.",
    );
  }

  return result;
};

const mergeRelayBatchTransportResult = (
  results: readonly RelayBatchCommandItemResult[],
  agentId: string,
): SocketTransportResult => {
  if (results.length === 0) {
    throw new PlugValidationError("Relay batch returned no command results.");
  }

  const items: NormalizedRpcItem[] = results.map(({ response }) => {
    const socketResponse = assertSocketTransportResult(response);
    const normalized = socketResponse.response;
    if (normalized.type === "single") {
      return normalized.item;
    }

    throw new PlugValidationError(
      "Relay batch item response must be a single JSON-RPC item.",
    );
  });

  const firstResponse = assertSocketTransportResult(results[0].response);
  const conversationId = firstResponse.conversationId;
  const serverTimings = results
    .map(
      ({ response }) =>
        assertSocketTransportResult(response).executionMetrics?.serverTimings,
    )
    .find((value) => value !== undefined);
  const metrics = buildMergedBatchMetrics(serverTimings);

  const response: NormalizedAgentRpcResponse = {
    type: "batch",
    success: items.every((item) => item.success),
    items,
  };

  return {
    channel: "socket",
    socketMode: "relay",
    agentId,
    requestId: results[0]?.requestId ?? "",
    notification: false,
    ...(conversationId ? { conversationId } : {}),
    response,
    rawResponsePayload: items,
    chunkPayloads: [],
    rawChunkFrames: [],
    ...(serverTimings ? { executionMetrics: { serverTimings } } : {}),
    ...(metrics ? { metrics } : {}),
  };
};

export class RelaySocketExecutionManager {
  private readonly managedTransport = createManagedSocketIoTransport({
    socketMode: "relay",
    logEventKey: "relay_manager",
  });

  private readonly agentSessions = new Map<string, AgentRelaySessionState>();

  private activeTransport?: RelaySocketTransport;

  private getAgentSession(agentId: string): AgentRelaySessionState {
    const existing = this.agentSessions.get(agentId);
    if (existing) {
      return existing;
    }

    const created: AgentRelaySessionState = {};
    this.agentSessions.set(agentId, created);
    return created;
  }

  private rememberStreamPullHints(agentId: string, payload: unknown): void {
    const recommended = extractRecommendedStreamPullWindowSize(payload);
    const max = extractMaxStreamPullWindowSize(payload);
    if (recommended === undefined && max === undefined) {
      return;
    }

    const session = this.getAgentSession(agentId);
    this.agentSessions.set(agentId, {
      ...session,
      ...(recommended !== undefined
        ? { agentRecommendedStreamPullWindowSize: recommended }
        : {}),
      ...(max !== undefined ? { agentMaxStreamPullWindowSize: max } : {}),
    });
  }

  private rememberConversation(
    agentId: string,
    conversationId: string | undefined,
  ): void {
    if (!conversationId) {
      return;
    }

    const session = this.getAgentSession(agentId);
    this.agentSessions.set(agentId, {
      ...session,
      conversationId,
    });
  }

  async execute(
    input: Parameters<PlugSocketExecutor>[0],
  ): Promise<Awaited<ReturnType<PlugSocketExecutor>>> {
    const transport = this.managedTransport.ensureTransport(
      input.session.credentials.baseUrl,
      input.session.accessToken,
    ) as RelaySocketTransport;
    this.activeTransport = transport;
    const agentSession = this.getAgentSession(input.agentId);

    try {
      if (Array.isArray(input.command)) {
        const batchResults = await executeRelayBatchCommand({
          transport,
          session: input.session,
          agentId: input.agentId,
          commands: input.command,
          timeoutMs: input.timeoutMs,
          payloadFrameCompression: input.payloadFrameCompression,
          payloadFrameSigning: input.payloadFrameSigning,
          responseMode: input.responseMode,
          bufferLimits: input.bufferLimits,
          streamPullWindowSize: input.streamPullWindowSize,
          agentRecommendedStreamPullWindowSize:
            agentSession.agentRecommendedStreamPullWindowSize,
          agentMaxStreamPullWindowSize: agentSession.agentMaxStreamPullWindowSize,
          fastPath: input.fastPath,
          requestServerTimings: input.requestServerTimings,
          managedTransport: true,
          reusedConversationId: agentSession.conversationId,
          skipConversationEnd: true,
        });

        const merged = mergeRelayBatchTransportResult(batchResults, input.agentId);
        this.rememberConversation(input.agentId, merged.conversationId);
        this.rememberStreamPullHints(input.agentId, merged.rawResponsePayload);
        return merged;
      }

      const result = assertSocketTransportResult(
        await executeRelayCommand({
          transport,
          session: input.session,
          agentId: input.agentId,
          command: input.command,
          timeoutMs: input.timeoutMs,
          payloadFrameCompression: input.payloadFrameCompression,
          payloadFrameSigning: input.payloadFrameSigning,
          responseMode: input.responseMode,
          bufferLimits: input.bufferLimits,
          streamPullWindowSize: input.streamPullWindowSize,
          agentRecommendedStreamPullWindowSize:
            agentSession.agentRecommendedStreamPullWindowSize,
          agentMaxStreamPullWindowSize: agentSession.agentMaxStreamPullWindowSize,
          fastPath: input.fastPath,
          requestServerTimings: input.requestServerTimings,
          managedTransport: true,
          reusedConversationId: agentSession.conversationId,
          skipConversationEnd: true,
        }),
      );

      this.rememberConversation(input.agentId, result.conversationId);
      this.rememberStreamPullHints(input.agentId, result.rawResponsePayload);

      return result;
    } catch (error: unknown) {
      this.managedTransport.markStale();
      this.agentSessions.delete(input.agentId);
      throw error;
    }
  }

  close(): void {
    if (this.activeTransport) {
      for (const session of this.agentSessions.values()) {
        if (session.conversationId) {
          this.activeTransport.emit(relayConversationEndEvent, {
            conversationId: session.conversationId,
          });
        }
      }
    }

    this.agentSessions.clear();
    this.activeTransport = undefined;
    this.managedTransport.close();
  }
}

export const createRelaySocketCommandExecutor = (): {
  readonly execute: PlugSocketExecutor;
  readonly close: () => void;
} => {
  const manager = new RelaySocketExecutionManager();

  return {
    execute: (input) => manager.execute(input),
    close: () => manager.close(),
  };
};
