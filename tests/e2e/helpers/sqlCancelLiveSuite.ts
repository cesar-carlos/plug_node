import { describe, expect, it } from "vitest";

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
import { maybeSkipMethodNotFound } from "./sqlE2eAssertions";

const cancelProbeSkipReason =
  "Configure PLUG_E2E_CANCEL_EXECUTION_ID and/or PLUG_E2E_CANCEL_REQUEST_ID to run sql.cancel E2E.";

export const registerPlugSqlCancelLiveE2E = (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
): void => {
  const label = channelLabel(channel);

  describe.sequential(`Plug Database ${label} sql.cancel E2E`, () => {
    it(`executes sql.cancel over ${label} when cancel ids are configured`, async ({
      skip,
    }) => {
      if (!e2eConfig.cancelExecutionId && !e2eConfig.cancelRequestId) {
        skip(cancelProbeSkipReason);
      }

      const node = new PublicPlugDatabase();
      const context = createLiveExecuteContext({
        credentials: credentialsForChannel(e2eConfig, channel),
        requestTimeoutMs: e2eConfig.timeoutMs,
        parameters: baseParameters(channel, {
          operation: "cancelSql",
          inputMode: "guided",
          responseMode: "rawJsonRpc",
          cancelExecutionId: e2eConfig.cancelExecutionId ?? "",
          cancelRequestId: e2eConfig.cancelRequestId ?? "",
          cancelOptions: {
            timeoutMs: e2eConfig.timeoutMs,
          },
        }),
      });

      const result = await executeOrSkipInfrastructure(node, context, skip);
      const output = result[0][0].json as Record<string, unknown>;
      maybeSkipInfrastructureResponse(output.response, skip);
      maybeSkipMethodNotFound(output.response, skip);

      const response = output.response as {
        type?: string;
        item?: { success?: boolean };
      };
      expect(response.type).toBe("single");
      expect(response.item?.success).toBe(true);
    });
  });
};
