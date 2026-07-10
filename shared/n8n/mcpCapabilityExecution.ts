import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

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
import { assertSqlIsReadOnly, validateGuidedSql } from "../n8n/plugSqlGuidedCommands";
import { executePlugToolsResource } from "../n8n/plugToolsExecution";
import type { CapabilityDefinition } from "../mcp/contracts";
import { resolveEffectiveMaxRows, maskSensitiveColumns } from "../mcp/governance";
import { extractPlugExecutionResult } from "../mcp/envelope";
import { isRecord } from "../utils/json";

export interface CapabilityExecutionResult {
  readonly rows: Record<string, unknown>[];
  readonly rowCount: number;
  readonly emptyResult: boolean;
  readonly effectiveMaxRows: number;
}

const buildSqlCapabilityRequest = (
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
  executionContext: ReturnType<typeof resolvePlugExecutionContext>,
  effectiveMaxRows: number,
): BuiltCommandRequest => {
  if (capability.executionConfig.providerType !== "sql") {
    throw new PlugValidationError("Capability execution config is not SQL-based.");
  }

  const { sql, channel } = capability.executionConfig;
  assertSqlIsReadOnly(sql, `Capability "${capability.name}" SQL`);
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
          max_rows: effectiveMaxRows,
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
    responseMode: "aggregatedSingleItem",
    command,
  };
};

const withMergedToolParameters = (
  context: IExecuteFunctions,
  mergedParams: Readonly<Record<string, unknown>>,
): IExecuteFunctions => {
  const originalGetNodeParameter = context.getNodeParameter.bind(context);
  return {
    ...context,
    // MCP tools/call is a single capability invocation, not a fan-out over upstream items.
    getInputData: () => [{ json: {} }],
    getNodeParameter: (
      name: string,
      itemIndex: number,
      fallbackValue?: unknown,
    ): unknown => {
      if (Object.prototype.hasOwnProperty.call(mergedParams, name)) {
        return mergedParams[name];
      }
      return originalGetNodeParameter(name, itemIndex, fallbackValue);
    },
  } as IExecuteFunctions;
};

const extractToolsRows = (
  items: readonly INodeExecutionData[],
): Record<string, unknown>[] => {
  const rows: Record<string, unknown>[] = [];
  for (const item of items) {
    if (!isRecord(item.json)) {
      continue;
    }

    const json = item.json as Record<string, unknown>;
    if (isRecord(json.result)) {
      rows.push(json.result);
      continue;
    }

    const { __plugTools: _toolsMeta, ...rest } = json;
    rows.push(rest);
  }
  return rows;
};

export const executeSqlCapability = async (
  context: IExecuteFunctions,
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
  config: PlugClientNodeExecutionConfig,
): Promise<CapabilityExecutionResult> => {
  if (capability.executionConfig.providerType !== "sql") {
    throw new PlugValidationError("Capability execution config is not SQL-based.");
  }

  const effectiveMaxRows = resolveEffectiveMaxRows(capability, params);
  const credentials = await readPlugClientCredentials(context, config);
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const executionContext = resolvePlugExecutionContext(
    context,
    0,
    credentials,
    "executeSql",
  );

  const builtRequest = buildSqlCapabilityRequest(
    capability,
    params,
    executionContext,
    effectiveMaxRows,
  );
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
    effectiveMaxRows,
  };
};

export const executeToolsCapability = async (
  context: IExecuteFunctions,
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
  config: PlugClientNodeExecutionConfig,
): Promise<CapabilityExecutionResult> => {
  if (capability.executionConfig.providerType !== "tools") {
    throw new PlugValidationError("Capability execution config is not tools-based.");
  }

  const { operation, staticParams } = capability.executionConfig;
  const mergedParams: Record<string, unknown> = {
    ...(staticParams ?? {}),
    ...params,
    operation,
    resource: "tools",
  };

  const toolContext = withMergedToolParameters(context, mergedParams);
  const result = await executePlugToolsResource(toolContext, {
    credentialName: config.credentialName,
    nodeDisplayName: config.nodeDisplayName,
  });

  const items = result[0] ?? [];
  const rows = extractToolsRows(items);
  const emptyResult = rows.length === 0;

  return {
    rows,
    rowCount: rows.length,
    emptyResult,
    effectiveMaxRows: Math.max(1, capability.governance.maxRows),
  };
};

export const executeCapability = async (
  context: IExecuteFunctions,
  capability: CapabilityDefinition,
  params: Readonly<Record<string, unknown>>,
  config: PlugClientNodeExecutionConfig,
): Promise<CapabilityExecutionResult> => {
  if (capability.executionConfig.providerType === "sql") {
    return executeSqlCapability(context, capability, params, config);
  }

  return executeToolsCapability(context, capability, params, config);
};
