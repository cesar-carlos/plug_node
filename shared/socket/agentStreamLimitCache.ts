import {
  extractMaxStreamPullWindowSize,
  extractRecommendedStreamPullWindowSize,
} from "./streamPullWindowPolicy";
import { isRecord } from "../utils/json";

export interface AgentStreamLimits {
  readonly agentRecommendedStreamPullWindowSize?: number;
  readonly agentMaxStreamPullWindowSize?: number;
}

/** Agent recommendations never belong to the hub capability cache. */
export class AgentStreamLimitCache {
  private readonly entries = new Map<
    string,
    { expiresAt: number; limits: AgentStreamLimits }
  >();
  private nextSweepAt = 0;

  constructor(private readonly now: () => number = Date.now) {}

  get(agentId: string): AgentStreamLimits {
    this.sweep();
    const entry = this.entries.get(agentId);
    if (!entry || entry.expiresAt <= this.now()) {
      this.entries.delete(agentId);
      return {};
    }
    return entry.limits;
  }

  remember(agentId: string, responseAgentId: string, payload: unknown): void {
    this.sweep();
    if (agentId !== responseAgentId) return;
    if (isRecord(payload)) {
      const declaredAgent = payload.agentId ?? payload.agent_id;
      if (declaredAgent !== undefined && declaredAgent !== agentId) return;
    }
    const recommended = extractRecommendedStreamPullWindowSize(payload);
    const max = extractMaxStreamPullWindowSize(payload);
    if (recommended === undefined && max === undefined) return;
    this.entries.set(agentId, {
      expiresAt: this.now() + 60_000,
      limits: {
        ...(recommended !== undefined
          ? { agentRecommendedStreamPullWindowSize: recommended }
          : {}),
        ...(max !== undefined ? { agentMaxStreamPullWindowSize: max } : {}),
      },
    });
  }

  private sweep(): void {
    const now = this.now();
    if (now < this.nextSweepAt) return;
    for (const [agentId, entry] of this.entries)
      if (entry.expiresAt <= now) this.entries.delete(agentId);
    this.nextSweepAt = now + 60_000;
  }

  clear(): void {
    this.entries.clear();
    this.nextSweepAt = 0;
  }
}
