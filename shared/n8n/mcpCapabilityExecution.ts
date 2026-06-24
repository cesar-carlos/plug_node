import type { IExecuteFunctions } from "n8n-workflow";

import { DEFAULT_API_VERSION, type BuiltCommandRequest } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { createExecutionSessionRunner } from "../auth/session";
import { buildN8nHttpRequester } from "../n8n/httpRequester";
import { applyCommandDefaults } from "../n8n/plugCommandDefaults";
import type { PlugClientNodeExecutionConfig } from "../n8n/plugClientExecutionTypes";
import {
  readPlugClientCredentials,
  resolvePlugExecutionContext,
} from "../n8n/plugCommandRequestBuilder";
import { executeBuiltCommandWithRetry } from "../n8n/plugTransportExecutor";
import { validateGuidedSql } from "../n8n/plugSqlGuidedCommands";
import type { CapabilityDefinition } from "../mcp/contracts";
import { maskSensitiveColumns } from "../mcp/governance";
import { extractPlugExecutionResult } from "../mcp/envelope";

export interface CapabilityExecutionResult {
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number;
  readonly emptyResult: boolean;
}

const buildSqlCapabilityRequest = (
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
  executionContext: ReturnType<typeof resolvePlugExecutionContext>,
): BuiltCommandRequest => {
  if (capability.executionConfig.providerType !== "sql") {
    throw new PlugValidationError("Capability execution config is not SQL-based.");
  }

  const { sql, channel, maxRows } = capability.executionConfig;
  validateGuidedSql(sql, params as Record<string, unknown>, {
    fieldLabel: `Capability "${capability.name}" SQL`,
    requireWhereForUpdateDelete: true,
  });

  const command = applyCommandDefaults(
    {
      method: "sql.execute",
      params: {
        sql,
        params: params as Record<string, unknown>,
        options: {
          max_rows: maxRows,
        },
      },
    },
    executionContext,
    DEFAULT_API_VERSION,
  );

  return {
    operation: "executeSql",
    agentId: executionContext.resolvedAgentId,
    channel,
    responseMode: "aggregatedJson",
    command,
  };
};

export const executeSqlCapability = async (
  context: IExecuteFunctions,
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
  config: PlugClientNodeExecutionConfig,
): Promise<CapabilityExecutionResult> => {
  const credentials = await readPlugClientCredentials(context, config);
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const executionContext = resolvePlugExecutionContext(
    context,
    0,
    credentials,
    "executeSql",
  );

  const builtRequest = buildSqlCapabilityRequest(capability, params, executionContext);
  const { jsonItems } = await executeBuiltCommandWithRetry({
    builtRequest,
    requester,
    sessionRunner,
    config: {
      ...config,
      supportsSocket: builtRequest.channel === "socket" ? config.supportsSocket : false,
    },
    includeMetadata: true,
  });

  const extracted = extractPlugExecutionResult(jsonItems);
  const rows = maskSensitiveColumns(
    extracted.rows ?? [],
    capability.governance.maskedColumns,
  );

  return {
    rows,
    rowCount: extracted.rowCount ?? rows.length,
    emptyResult: extracted.emptyResult === true,
  };
};
