import { describe, expect, it } from "vitest";

import { PlugDatabase as PublicPlugDatabase } from "../../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import type { PlugE2EConfig, PlugE2EStressConfig } from "./e2eEnv";
import { executeOrSkipInfrastructure, type ExecutableNode } from "./executeOrSkip";
import { createLiveExecuteContext } from "./liveExecuteContext";
import {
  classifyStressError,
  runWithConcurrency,
  summarizeStressOutcomes,
  type StressAttemptOutcome,
} from "./stressOutcomes";

type StressChannel = "rest" | "socket";

const stressDisabledSkipReason =
  "Stress E2E is disabled. Set PLUG_E2E_STRESS_ENABLED=1 to run hub load probes.";

const channelLabel = (channel: StressChannel): string =>
  channel === "rest" ? "REST" : "SOCKET";

const credentialsForChannel = (config: PlugE2EConfig, channel: StressChannel) =>
  channel === "rest" ? config.credentials : config.socketCredentials;

const stressQuery = (config: PlugE2EConfig): string => config.emptySqlQuery;

const estimateStressTimeoutMs = (
  stress: PlugE2EStressConfig,
  commandTimeoutMs: number,
): number => {
  const waves = Math.ceil(stress.requestCount / stress.concurrency);
  return waves * commandTimeoutMs + 15_000;
};

const executeStressAttempt = async (
  node: ExecutableNode,
  config: PlugE2EConfig,
  channel: StressChannel,
  attemptIndex: number,
): Promise<StressAttemptOutcome> => {
  const startedAt = Date.now();
  const context = createLiveExecuteContext({
    credentials: credentialsForChannel(config, channel),
    requestTimeoutMs: config.timeoutMs,
    parameters: {
      ...(channel === "socket" ? { channel: "socket" } : {}),
      operation: "executeSql",
      inputMode: "guided",
      responseMode: "aggregatedJson",
      includePlugMetadata: true,
      sql: stressQuery(config),
      sqlOptions: {
        timeoutMs: config.timeoutMs,
        maxRows: 10,
      },
    },
  });

  try {
    const result = await node.execute.call(context);
    const durationMs = Date.now() - startedAt;

    if (!Array.isArray(result[0])) {
      return {
        kind: "failure",
        durationMs,
        detail: `attempt ${attemptIndex}: missing output branch`,
      };
    }

    return { kind: "success", durationMs };
  } catch (error: unknown) {
    return {
      kind: classifyStressError(error),
      durationMs: Date.now() - startedAt,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
};

const assertStressSummary = (
  summary: ReturnType<typeof summarizeStressOutcomes>,
  stress: PlugE2EStressConfig,
): void => {
  expect(summary.failures).toBe(0);

  const healthyResponses = summary.successes + summary.rateLimited;
  const minHealthy = Math.ceil(summary.total * stress.minSuccessRatio);
  expect(healthyResponses).toBeGreaterThanOrEqual(minHealthy);

  if (summary.infrastructure > 0) {
    expect(summary.infrastructure).toBeLessThan(summary.total);
  }
};

export const registerPlugStressLiveE2E = (e2eConfig: PlugE2EConfig): void => {
  describe.sequential("Plug Database stress E2E", () => {
    if (!e2eConfig.stress) {
      it("requires PLUG_E2E_STRESS_ENABLED=1", ({ skip }) => {
        skip(stressDisabledSkipReason);
      });
      return;
    }

    const stress = e2eConfig.stress;

    for (const channel of stress.channels) {
      it(
        `sustains bounded concurrent ${channelLabel(channel)} SQL probes without unexpected failures`,
        async ({ skip }) => {
          const node = new PublicPlugDatabase();
          const warmupContext = createLiveExecuteContext({
            credentials: credentialsForChannel(e2eConfig, channel),
            requestTimeoutMs: e2eConfig.timeoutMs,
            parameters: {
              ...(channel === "socket" ? { channel: "socket" } : {}),
              operation: "validateContext",
              validateContextOptions: {
                timeoutMs: e2eConfig.timeoutMs,
              },
            },
          });

          await executeOrSkipInfrastructure(node, warmupContext, skip);

          const startedAt = Date.now();

          const outcomes = await runWithConcurrency(
            stress.requestCount,
            stress.concurrency,
            (index) => executeStressAttempt(node, e2eConfig, channel, index),
          );

          const summary = summarizeStressOutcomes(outcomes, Date.now() - startedAt);

          expect(summary.total).toBe(stress.requestCount);
          assertStressSummary(summary, stress);
        },
        estimateStressTimeoutMs(stress, e2eConfig.timeoutMs),
      );
    }
  });
};
