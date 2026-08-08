import type {
  IDataObject,
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  ResourceMapperFields,
} from "n8n-workflow";

import { buildAuditEntry } from "../../generated/shared/mcp/auditLogger";
import type { CapabilityDefinition } from "../../generated/shared/mcp/contracts";
import { MCP_PROTOCOL_VERSION } from "../../generated/shared/mcp/contracts";
import { buildMcpCallResponse, buildMcpError } from "../../generated/shared/mcp/envelope";
import { mapPlugErrorToFriendlyMessage } from "../../generated/shared/mcp/errorMapper";
import { isCapabilityBlockedByNameList } from "../../generated/shared/mcp/forbiddenCapabilities";
import { enforceGovernance } from "../../generated/shared/mcp/governance";
import { validateParams } from "../../generated/shared/mcp/paramValidator";
import {
  buildRegistry,
  listCapabilities,
  lookupCapability,
  type CapabilityRegistry,
} from "../../generated/shared/mcp/registry";
import { executeCapability } from "../../generated/shared/n8n/mcpCapabilityExecution";
import { buildMcpServerNodeDescription } from "../../generated/shared/n8n/mcpServerDescription";
import { serializeErrorForContinueOnFail } from "../../generated/shared/output/errorOutput";
import { createSocketCommandExecutor } from "../PlugDatabase/socketCommandExecutor";
import { createRelaySocketExecutorForNode } from "../PlugDatabase/socketRelayExecutor";
import {
  assertCapabilityAllowedForAgent,
  loadCapabilityNameOptions,
  loadCapabilityParamResourceMapperFields,
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

type SocketExecutors = {
  readonly socketCommandExecutor: ReturnType<typeof createSocketCommandExecutor>;
  readonly relaySocketExecutor: ReturnType<typeof createRelaySocketExecutorForNode>;
};

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
  sockets: SocketExecutors,
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

  if (maxToolCallsPerTurn > 0 && toolCallCount > maxToolCallsPerTurn) {
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
      {
        supportsSocket: true,
        credentialName: "plugDatabaseAccountApi",
        nodeDisplayName: "Plug MCP Server",
        socketExecutor: sockets.socketCommandExecutor.execute,
        legacySocketExecutor: sockets.relaySocketExecutor.execute,
      },
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

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- MCP Server is an orchestration node, not a direct AI tool.
export class PlugMcpServer implements INodeType {
  description: INodeTypeDescription = {
    ...buildMcpServerNodeDescription({
      displayName: "Plug MCP Server",
      technicalName: "plugMcpServer",
      credentialName: "plugDatabaseAccountApi",
      iconBaseName: "plugDatabaseV2",
      description:
        "Expose governed Plug capabilities to AI agents through an MCP-style tools/list and tools/call contract.",
    }),
    subtitle: '={{$parameter["operation"]}}',
    icon: {
      light: "file:plugDatabaseV2.svg",
      dark: "file:plugDatabaseV2.dark.svg",
    },
    codex: {
      alias: ["Plug MCP", "MCP Server", "AI Capabilities", "Plug AI Tools"],
    },
  };

  methods = {
    loadOptions: {
      async getCapabilityNames(
        this: ILoadOptionsFunctions,
      ): Promise<INodePropertyOptions[]> {
        return loadCapabilityNameOptions(this);
      },
    },
    resourceMapping: {
      async getCapabilityParamFields(
        this: ILoadOptionsFunctions,
      ): Promise<ResourceMapperFields> {
        return loadCapabilityParamResourceMapperFields(this);
      },
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const itemCount = Math.max(items.length, 1);
    const returnData: INodeExecutionData[] = [];

    try {
      const operation = this.getNodeParameter("operation", 0, "list") as
        | "list"
        | "call"
        | "validate";

      if (operation === "validate") {
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
          returnData.push(executeValidateItem(this, itemIndex));
        }
        return [returnData];
      }

      if (operation === "list") {
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
          try {
            returnData.push(executeListItem(this, itemIndex));
          } catch (error: unknown) {
            if (this.continueOnFail()) {
              returnData.push(
                toOutputItem(
                  { error: serializeErrorForContinueOnFail(error) },
                  itemIndex,
                ),
              );
              continue;
            }
            throw error;
          }
        }
        return [returnData];
      }

      const relaySocketExecutor = createRelaySocketExecutorForNode();
      const socketCommandExecutor = createSocketCommandExecutor(
        relaySocketExecutor.execute,
      );
      const sockets: SocketExecutors = {
        socketCommandExecutor,
        relaySocketExecutor,
      };

      try {
        for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
          try {
            const definitions = parseCapabilityDefinitions(this, itemIndex);
            const registry = buildRegistry(definitions);
            returnData.push(
              await executeCallItem(this, itemIndex, definitions, registry, sockets),
            );
          } catch (error: unknown) {
            if (this.continueOnFail()) {
              returnData.push(
                toOutputItem(
                  { error: serializeErrorForContinueOnFail(error) },
                  itemIndex,
                ),
              );
              continue;
            }
            throw error;
          }
        }
      } finally {
        socketCommandExecutor.close();
        relaySocketExecutor.close();
      }

      return [returnData];
    } catch (error: unknown) {
      if (this.continueOnFail()) {
        return [
          [
            toOutputItem({
              error: serializeErrorForContinueOnFail(error),
            }),
          ],
        ];
      }

      throw error;
    }
  }
}
