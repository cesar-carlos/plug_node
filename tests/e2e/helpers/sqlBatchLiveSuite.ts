import { describe, it } from "vitest";

import { PlugDatabase as PublicPlugDatabase } from "../../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import type { PlugE2EConfig } from "./e2eEnv";
import { executeOrSkipInfrastructure } from "./executeOrSkip";
import { createLiveExecuteContext } from "./liveExecuteContext";
import {
  baseParameters,
  channelLabel,
  credentialsForChannel,
  maybeSkipInfrastructureResponse,
  type SqlLiveChannel,
} from "./sqlE2eChannel";
import {
  expectSuccessfulBatchResponse,
  maybeSkipMethodNotFound,
} from "./sqlE2eAssertions";

export const registerPlugSqlBatchLiveE2E = (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
): void => {
  const label = channelLabel(channel);

  describe.sequential(`Plug Database ${label} executeBatch E2E`, () => {
    it(`executes sql.executeBatch over ${label}`, async ({ skip }) => {
      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentialsForChannel(e2eConfig, channel),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "executeBatch",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          batchCommandsJson: e2eConfig.batchCommandsJson,
          batchOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      maybeSkipInfrastructureResponse(output.response, skip);
      maybeSkipMethodNotFound(output.response, skip);

      expectSuccessfulBatchResponse(output);
    });
  });
};
