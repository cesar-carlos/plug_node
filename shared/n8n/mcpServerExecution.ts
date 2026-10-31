import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { buildAuditEntry } from "../mcp/auditLogger";
import type { CapabilityDefinition } from "../mcp/contracts";
import { MCP_PROTOCOL_VERSION } from "../mcp/contracts";
import { buildMcpCallResponse, buildMcpError } from "../mcp/envelope";
import { mapPlugErrorToFriendlyMessage } from "../mcp/errorMapper";
import { isCapabilityBlockedByNameList } from "../mcp/forbiddenCapabilities";
import { enforceGovernance } from "../mcp/governance";
import { validateParams } from "../mcp/paramValidator";
import {
  buildRegistry,
  listCapabilities,
  lookupCapability,
  type CapabilityRegistry,
} from "../mcp/registry";
import { executeCapability } from "../n8n/mcpCapabilityExecution";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";
import { serializeErrorForContinueOnFail } from "../output/errorOutput";
import {
  assertCapabilityAllowedForAgent,
  parseCapabilityDefinitions,
  parseCapabilityParams,
  readAuditContext,
  readForbiddenCapabilityNames,
  readToolCallBudget,
  validateCapabilityDefinitionsResult,
} from "./mcpServerHelpers";

const toOutputItem = (json: IDataObject, itemIndex = 0): INodeExecutionData => ({
  json,
  pairedItem: { item: itemIndex },
});

const toErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

const executeValidateItem = (
  context: IExecuteFunctions,
  itemIndex: number,
): INodeExecutionData => {
  try {
    const definitions = parseCapabilityDefinitions(context, itemIndex);
    return toOutputItem(
      validateCapabilityDefinitionsResult(definitions) as unknown as IDataObject,
      itemIndex,
    );
  } catch (error: unknown) {
    return toOutputItem(
      {
        valid: false,
        error: toErrorMessage(error),
      },
      itemIndex,
    );
  }
};

const executeListItem = (
  context: IExecuteFunctions,
  itemIndex: number,
): INodeExecutionData => {
  const definitions = parseCapabilityDefinitions(context, itemIndex);
  const registry = buildRegistry(definitions);
  const forbiddenNames = readForbiddenCapabilityNames(context, itemIndex);
  const protocolVersion = String(
    context.getNodeParameter("mcpProtocolVersion", itemIndex, MCP_PROTOCOL_VERSION),
  );

  return toOutputItem(
    {
      protocolVersion,
      tools: listCapabilities(registry, forbiddenNames) as unknown as IDataObject[],
    },
    itemIndex,
  );
};

const executeCallItem = async (
  context: IExecuteFunctions,
  itemIndex: number,
  definitions: readonly CapabilityDefinition[],
  registry: CapabilityRegistry,
  config: PlugClientNodeExecutionConfig,
  executionCallCount: number,
): Promise<INodeExecutionData> => {
  const capabilityName = String(
    context.getNodeParameter("capabilityName", itemIndex, ""),
  );
  const startedAt = Date.now();
  const auditContext = readAuditContext(context, itemIndex);
  const rawParams = parseCapabilityParams(context, itemIndex);
  const forbiddenNames = readForbiddenCapabilityNames(context, itemIndex);
  const { maxToolCallsPerTurn, toolCallCount } = readToolCallBudget(context, itemIndex);
  const includeAuditInOutput = context.getNodeParameter(
    "includeAuditInOutput",
    itemIndex,
    true,
  ) as boolean;

  const withAudit = (
    response: IDataObject,
    auditParams: Readonly<Record<string, unknown>>,
    extras?: {
      readonly rowCount?: number;
      readonly emptyResult?: boolean;
      readonly truncated?: boolean;
      readonly isError?: boolean;
      readonly errorMessage?: string;
    },
  ): IDataObject => {
    if (!includeAuditInOutput) {
      return response;
    }

    return {
      ...response,
      audit: buildAuditEntry({
        capability: capabilityName,
        params: auditParams,
        context: auditContext,
        startedAt,
        finishedAt: Date.now(),
        ...extras,
      }),
    };
  };

  if (
    maxToolCallsPerTurn > 0 &&
    Math.max(toolCallCount, executionCallCount) > maxToolCallsPerTurn
  ) {
    const message = `Maximum of ${maxToolCallsPerTurn} tool calls per turn exceeded.`;
    const response = buildMcpError({
      capability: capabilityName,
      message,
      executionMs: Date.now() - startedAt,
    });
    return toOutputItem(
      withAudit(response as unknown as IDataObject, rawParams, {
        isError: true,
        errorMessage: message,
      }),
      itemIndex,
    );
  }

  const capability = lookupCapability(registry, capabilityName);
  if (!capability) {
    const message =
      definitions.length === 0
        ? "No capabilities are registered. Configure Capability Definitions JSON before calling this node."
        : `Capability "${capabilityName}" is not registered.`;
    const response = buildMcpError({
      capability: capabilityName,
      message,
      executionMs: Date.now() - startedAt,
    });
    return toOutputItem(
      withAudit(response as unknown as IDataObject, rawParams, {
        isError: true,
        errorMessage: message,
      }),
      itemIndex,
    );
  }

  if (isCapabilityBlockedByNameList(capability.name, forbiddenNames)) {
    const message = `Capability "${capability.name}" is forbidden for this agent profile.`;
    const response = buildMcpError({
      capability: capability.name,
      message,
      executionMs: Date.now() - startedAt,
    });
    return toOutputItem(
      withAudit(response as unknown as IDataObject, rawParams, {
        isError: true,
        errorMessage: message,
      }),
      itemIndex,
    );
  }

  try {
    assertCapabilityAllowedForAgent(capability);
  } catch (error: unknown) {
    const message = mapPlugErrorToFriendlyMessage(error);
    const response = buildMcpError({
      capability: capability.name,
      message,
      executionMs: Date.now() - startedAt,
    });
    return toOutputItem(
      withAudit(response as unknown as IDataObject, rawParams, {
        isError: true,
        errorMessage: message,
      }),
      itemIndex,
    );
  }

  const validation = validateParams(capability.parameters, rawParams);
  if (!validation.ok) {
    const response = buildMcpError({
      capability: capability.name,
      message: validation.error,
      executionMs: Date.now() - startedAt,
    });
    return toOutputItem(
      withAudit(response as unknown as IDataObject, rawParams, {
        isError: true,
        errorMessage: validation.error,
      }),
      itemIndex,
    );
  }

  const governance = enforceGovernance(capability, validation.coerced);
  if (!governance.ok) {
    const response = buildMcpError({
      capability: capability.name,
      message: governance.error,
      executionMs: Date.now() - startedAt,
    });
    return toOutputItem(
      withAudit(response as unknown as IDataObject, validation.coerced, {
        isError: true,
        errorMessage: governance.error,
      }),
      itemIndex,
    );
  }

  try {
    const executionResult = await executeCapability(
      context,
      capability,
      validation.coerced,
      config,
    );

    const finishedAt = Date.now();
    const response = buildMcpCallResponse({
      capability: capability.name,
      rows: executionResult.rows,
      rowCount: executionResult.rowCount,
      maxRows: executionResult.effectiveMaxRows,
      executionMs: finishedAt - startedAt,
      emptyResult: executionResult.emptyResult,
    });

    return toOutputItem(
      withAudit(response as unknown as IDataObject, validation.coerced, {
        rowCount: executionResult.rowCount,
        emptyResult: executionResult.emptyResult,
        truncated: response.meta.truncated === true,
      }),
      itemIndex,
    );
  } catch (error: unknown) {
    const friendlyMessage = mapPlugErrorToFriendlyMessage(error);
    const response = buildMcpError({
      capability: capability.name,
      message: friendlyMessage,
      executionMs: Date.now() - startedAt,
    });

    return toOutputItem(
      withAudit(response as unknown as IDataObject, validation.coerced, {
        isError: true,
        errorMessage: friendlyMessage,
      }),
      itemIndex,
    );
  }
};

export const executeMcpServerNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const itemCount = Math.max(context.getInputData().length, 1);
  const output: INodeExecutionData[] = [];
  const operation = context.getNodeParameter("operation", 0, "list");
  if (!["validate", "list", "call"].includes(String(operation)))
    throw new Error("Unsupported MCP operation.");
  let callCount = 0;
  for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
    try {
      if (operation === "validate") output.push(executeValidateItem(context, itemIndex));
      else if (operation === "list") output.push(executeListItem(context, itemIndex));
      else {
        const budget = readToolCallBudget(context, itemIndex);
        callCount = Math.max(callCount + 1, budget.toolCallCount);
        const definitions = parseCapabilityDefinitions(context, itemIndex);
        output.push(
          await executeCallItem(
            context,
            itemIndex,
            definitions,
            buildRegistry(definitions),
            config,
            callCount,
          ),
        );
      }
    } catch (error: unknown) {
      if (!context.continueOnFail()) throw error;
      output.push(
        toOutputItem({ error: serializeErrorForContinueOnFail(error) }, itemIndex),
      );
    }
  }
  return [output];
};
