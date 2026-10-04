import { describe, expect, it } from "vitest";
import { AgentStreamLimitCache } from "../../shared/socket/agentStreamLimitCache";

describe("AgentStreamLimitCache", () => {
  it("should isolate identified agent recommendations and expire them after 60 seconds", () => {
    let now = 0;
    const cache = new AgentStreamLimitCache(() => now);
    cache.remember("a", "a", {
      item: {
        result: {
          limits: { maxStreamPullWindowSize: 16, recommendedStreamPullWindowSize: 8 },
        },
      },
    });
    cache.remember("b", "b", { result: { maxStreamPullWindowSize: 128 } });
    cache.remember("c", "a", { maxStreamPullWindowSize: 512 });
    cache.remember("d", "d", { agentId: "a", maxStreamPullWindowSize: 512 });
    expect(cache.get("a")).toEqual({
      agentRecommendedStreamPullWindowSize: 8,
      agentMaxStreamPullWindowSize: 16,
    });
    expect(cache.get("b")).toEqual({ agentMaxStreamPullWindowSize: 128 });
    expect(cache.get("c")).toEqual({});
    expect(cache.get("d")).toEqual({});
    expect(cache.get("unknown")).toEqual({});
    now = 60_000;
    expect(cache.get("a")).toEqual({});
    cache.clear();
    expect(cache.get("b")).toEqual({});
  });
});
