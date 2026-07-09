import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildAuditEntry } from "../../generated/shared/mcp/auditLogger";
import { MCP_PROTOCOL_VERSION } from "../../generated/shared/mcp/contracts";
import { buildMcpCallResponse, buildMcpError } from "../../generated/shared/mcp/envelope";
import { mapPlugErrorToFriendlyMessage } from "../../generated/shared/mcp/errorMapper";
import {
  isCapabilityBlockedByNameList,
} from "../../generated/shared/mcp/forbiddenCapabilities";
import { enforceGovernance } from "../../generated/shared/mcp/governance";
import { validateParams } from "../../generated/shared/mcp/paramValidator";
import {
  buildRegistry,
  listCapabilities,
  lookupCapability,
} from "../../generated/shared/mcp/registry";
import { executeCapability } from "../../generated/shared/n8n/mcpCapabilityExecution";
import { buildMcpServerNodeDescription } from "../../generated/shared/n8n/mcpServerDescription";
import { serializeErrorForContinueOnFail } from "../../generated/shared/output/errorOutput";
import { createSocketCommandExecutor } from "../PlugDatabase/socketCommandExecutor";
import { createRelaySocketExecutorForNode } from "../PlugDatabase/socketRelayExecutor";
import {
  assertCapabilityAllowedForAgent,
  parseCapabilityDefinitions,
  parseCapabilityParams,
  readAuditContext,
  readForbiddenCapabilityNames,
} from "./mcpServerHelpers";

const toOutputItem = (json: IDataObject, itemIndex = 0): INodeExecutionData => ({
  json,
  pairedItem: { item: itemIndex },
});

const readToolCallBudget = (
  context: IExecuteFunctions,
): { readonly maxToolCallsPerTurn: number; readonly toolCallCount: number } => {
  const maxRaw = Number(context.getNodeParameter("maxToolCallsPerTurn", 0, 0));
  const countRaw = Number(context.getNodeParameter("toolCallCount", 0, 0));
  const maxToolCallsPerTurn =
    Number.isFinite(maxRaw) && maxRaw > 0 ? Math.trunc(maxRaw) : 0;
  const toolCallCount =
    Number.isFinite(countRaw) && countRaw > 0 ? Math.trunc(countRaw) : 0;
  return { maxToolCallsPerTurn, toolCallCount };
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

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      const operation = this.getNodeParameter("operation", 0, "list") as "list" | "call";
      const definitions = parseCapabilityDefinitions(this, 0);
      const registry = buildRegistry(definitions);
      const forbiddenNames = readForbiddenCapabilityNames(this, 0);
      const protocolVersion = String(
        this.getNodeParameter("mcpProtocolVersion", 0, MCP_PROTOCOL_VERSION),
      );

      if (operation === "list") {
        return [
          [
            toOutputItem({
              protocolVersion,
              tools: listCapabilities(registry, forbiddenNames) as unknown as IDataObject[],
            }),
          ],
        ];
      }

      const capabilityName = String(this.getNodeParameter("capabilityName", 0, ""));
      const startedAt = Date.now();
      const auditContext = readAuditContext(this, 0);
      const rawParams = parseCapabilityParams(this, 0);
      const { maxToolCallsPerTurn, toolCallCount } = readToolCallBudget(this);

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
      ): IDataObject => ({
        ...response,
        audit: buildAuditEntry({
          capability: capabilityName,
          params: auditParams,
          context: auditContext,
          startedAt,
          finishedAt: Date.now(),
          ...extras,
        }),
      });

      if (maxToolCallsPerTurn > 0 && toolCallCount > maxToolCallsPerTurn) {
        const message = `Maximum of ${maxToolCallsPerTurn} tool calls per turn exceeded.`;
        const response = buildMcpError({
          capability: capabilityName,
          message,
          executionMs: Date.now() - startedAt,
        });
        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, rawParams, {
                isError: true,
                errorMessage: message,
              }),
            ),
          ],
        ];
      }

      const capability = lookupCapability(registry, capabilityName);
      if (!capability) {
        const message = `Capability "${capabilityName}" is not registered.`;
        const response = buildMcpError({
          capability: capabilityName,
          message,
          executionMs: Date.now() - startedAt,
        });
        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, rawParams, {
                isError: true,
                errorMessage: message,
              }),
            ),
          ],
        ];
      }

      if (isCapabilityBlockedByNameList(capability.name, forbiddenNames)) {
        const message = `Capability "${capability.name}" is forbidden for this agent profile.`;
        const response = buildMcpError({
          capability: capability.name,
          message,
          executionMs: Date.now() - startedAt,
        });
        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, rawParams, {
                isError: true,
                errorMessage: message,
              }),
            ),
          ],
        ];
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
        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, rawParams, {
                isError: true,
                errorMessage: message,
              }),
            ),
          ],
        ];
      }

      const validation = validateParams(capability.parameters, rawParams);
      if (!validation.ok) {
        const response = buildMcpError({
          capability: capability.name,
          message: validation.error,
          executionMs: Date.now() - startedAt,
        });
        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, rawParams, {
                isError: true,
                errorMessage: validation.error,
              }),
            ),
          ],
        ];
      }

      const governance = enforceGovernance(capability, validation.coerced);
      if (!governance.ok) {
        const response = buildMcpError({
          capability: capability.name,
          message: governance.error,
          executionMs: Date.now() - startedAt,
        });
        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, validation.coerced, {
                isError: true,
                errorMessage: governance.error,
              }),
            ),
          ],
        ];
      }

      const relaySocketExecutor = createRelaySocketExecutorForNode();
      const socketCommandExecutor = createSocketCommandExecutor(
        relaySocketExecutor.execute,
      );

      try {
        const executionResult = await executeCapability(
          this,
          capability,
          validation.coerced,
          {
            supportsSocket: true,
            credentialName: "plugDatabaseAccountApi",
            nodeDisplayName: "Plug MCP Server",
            socketExecutor: socketCommandExecutor.execute,
            legacySocketExecutor: relaySocketExecutor.execute,
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

        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, validation.coerced, {
                rowCount: executionResult.rowCount,
                emptyResult: executionResult.emptyResult,
                truncated: response.meta.truncated === true,
              }),
            ),
          ],
        ];
      } catch (error: unknown) {
        const friendlyMessage = mapPlugErrorToFriendlyMessage(error);
        const response = buildMcpError({
          capability: capability.name,
          message: friendlyMessage,
          executionMs: Date.now() - startedAt,
        });

        return [
          [
            toOutputItem(
              withAudit(response as unknown as IDataObject, validation.coerced, {
                isError: true,
                errorMessage: friendlyMessage,
              }),
            ),
          ],
        ];
      } finally {
        socketCommandExecutor.close();
        relaySocketExecutor.close();
      }
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
