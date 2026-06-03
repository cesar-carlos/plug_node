import { describe, expect, it } from "vitest";

import {
  classifyStressError,
  runWithConcurrency,
  summarizeStressOutcomes,
} from "../e2e/helpers/stressOutcomes";

describe("stressOutcomes", () => {
  it("classifies rate limit errors separately from hard failures", () => {
    expect(classifyStressError(new Error("Plug rate limited the socket request."))).toBe(
      "rate_limited",
    );
    expect(classifyStressError(new Error("Unexpected socket failure."))).toBe("failure");
  });

  it("runs workers with a bounded concurrency pool", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const results = await runWithConcurrency(8, 3, async (index) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return index;
    });

    expect(results).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("summarizes attempt outcomes", () => {
    const summary = summarizeStressOutcomes(
      [
        { kind: "success", durationMs: 10 },
        { kind: "rate_limited", durationMs: 20 },
        { kind: "failure", durationMs: 30 },
      ],
      100,
    );

    expect(summary).toMatchObject({
      total: 3,
      successes: 1,
      rateLimited: 1,
      failures: 1,
      elapsedMs: 100,
      maxDurationMs: 30,
    });
  });
});
