import { describe, expect, it } from "vitest";

import {
  clampStreamPullWindowSize,
  extractMaxStreamPullWindowSize,
  extractRecommendedStreamPullWindowSize,
  resolveAdaptiveStreamPullWindowSize,
} from "../../packages/n8n-nodes-plug-database/generated/shared/socket/streamPullWindowPolicy";

describe("streamPullWindowPolicy", () => {
  it("extracts recommended stream pull window from nested agent capabilities", () => {
    expect(
      extractRecommendedStreamPullWindowSize({
        capabilities: {
          extensions: {
            recommendedStreamPullWindowSize: 16,
          },
        },
      }),
    ).toBe(16);
  });

  it("clamps explicit configured window to hub max while honoring configured over agent recommendation", () => {
    expect(
      resolveAdaptiveStreamPullWindowSize({
        configured: 64,
        agentRecommended: 8,
        fallback: 32,
      }),
    ).toBe(64);

    expect(
      resolveAdaptiveStreamPullWindowSize({
        configured: 2000,
        agentRecommended: 500,
      }),
    ).toBe(1000);

    expect(
      resolveAdaptiveStreamPullWindowSize({
        agentRecommended: 8,
        fallback: 32,
      }),
    ).toBe(8);
  });

  it("extracts max stream pull window hints", () => {
    expect(
      extractMaxStreamPullWindowSize({
        extensions: {
          maxStreamPullWindowSize: 128,
        },
      }),
    ).toBe(128);
  });

  it("never exceeds the hub ceiling", () => {
    expect(clampStreamPullWindowSize(5000)).toBe(1000);
  });

  it("uses relay default fallback of 256 when no configured or agent hint is present", () => {
    expect(resolveAdaptiveStreamPullWindowSize({})).toBe(256);
  });
});
