import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { buildAuditEntry } from "../../generated/shared/mcp/auditLogger";
import { MCP_PROTOCOL_VERSION } from "../../generated/shared/mcp/contracts";
import { buildMcpCallResponse, buildMcpError } from "../../generated/shared/mcp/envelope";
import { mapPlugErrorToFriendlyMessage } from "../../generated/shared/mcp/errorMapper";
import { enforceGovernance } from "../../generated/shared/mcp/governance";
import { validateParams } from "../../generated/shared/mcp/paramValidator";
import {
  buildRegistry,
  listCapabilities,
  lookupCapability,
} from "../../generated/shared/mcp/registry";
import { executeSqlCapability } from "../../generated/shared/n8n/mcpCapabilityExecution";
import { buildMcpServerNodeDescription } from "../../generated/shared/n8n/mcpServerDescription";
import { serializeErrorForContinueOnFail } from "../../generated/shared/output/errorOutput";
import { createSocketCommandExecutor } from "../PlugDatabase/socketCommandExecutor";
import { createRelaySocketExecutorForNode } from "../PlugDatabase/socketRelayExecutor";
import {
  assertCapabilityAllowedForAgent,
  parseCapabilityDefinitions,
  parseCapabilityParams,
  readAuditContext,
} from "./mcpServerHelpers";

const toOutputItem = (json: IDataObject, itemIndex = 0): INodeExecutionData => ({
  json,
  pairedItem: { item: itemIndex },
});

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
      const protocolVersion = String(
        this.getNodeParameter("mcpProtocolVersion", 0, MCP_PROTOCOL_VERSION),
      );

      if (operation === "list") {
        return [
          [
            toOutputItem({
              protocolVersion,
              tools: listCapabilities(registry) as unknown as IDataObject[],
            }),
          ],
        ];
      }

      const capabilityName = String(this.getNodeParameter("capabilityName", 0, ""));
      const capability = lookupCapability(registry, capabilityName);
      if (!capability) {
        const response = buildMcpError({
          capability: capabilityName,
          message: `Capability "${capabilityName}" is not registered.`,
          executionMs: 0,
        });
        return [[toOutputItem(response as unknown as IDataObject)]];
      }

      assertCapabilityAllowedForAgent(this, capability);

      const startedAt = Date.now();
      const auditContext = readAuditContext(this, 0);
      const rawParams = parseCapabilityParams(this, 0);

      const validation = validateParams(capability.parameters, rawParams);
      if (!validation.ok) {
        const response = buildMcpError({
          capability: capability.name,
          message: validation.error,
          executionMs: Date.now() - startedAt,
        });
        return [
          [
            toOutputItem({
              ...(response as unknown as IDataObject),
              audit: buildAuditEntry({
                capability: capability.name,
                params: rawParams,
                context: auditContext,
                startedAt,
                finishedAt: Date.now(),
                isError: true,
                errorMessage: validation.error,
              }),
            }),
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
            toOutputItem({
              ...(response as unknown as IDataObject),
              audit: buildAuditEntry({
                capability: capability.name,
                params: validation.coerced,
                context: auditContext,
                startedAt,
                finishedAt: Date.now(),
                isError: true,
                errorMessage: governance.error,
              }),
            }),
          ],
        ];
      }

      const relaySocketExecutor = createRelaySocketExecutorForNode();
      const socketCommandExecutor = createSocketCommandExecutor(
        relaySocketExecutor.execute,
      );

      try {
        if (capability.executionConfig.providerType !== "sql") {
          throw new NodeOperationError(
            this.getNode(),
            `Capability "${capability.name}" uses a tools provider, which is not supported in MCP Server V1.`,
          );
        }

        const executionResult = await executeSqlCapability(
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
          maxRows: capability.governance.maxRows,
          executionMs: finishedAt - startedAt,
          emptyResult: executionResult.emptyResult,
        });

        return [
          [
            toOutputItem({
              ...(response as unknown as IDataObject),
              audit: buildAuditEntry({
                capability: capability.name,
                params: validation.coerced,
                context: auditContext,
                startedAt,
                finishedAt,
                rowCount: executionResult.rowCount,
                emptyResult: executionResult.emptyResult,
                truncated: response.meta.truncated === true,
              }),
            }),
          ],
        ];
      } catch (error: unknown) {
        const friendlyMessage = mapPlugErrorToFriendlyMessage(error);
        const finishedAt = Date.now();
        const response = buildMcpError({
          capability: capability.name,
          message: friendlyMessage,
          executionMs: finishedAt - startedAt,
        });

        return [
          [
            toOutputItem({
              ...(response as unknown as IDataObject),
              audit: buildAuditEntry({
                capability: capability.name,
                params: validation.coerced,
                context: auditContext,
                startedAt,
                finishedAt,
                isError: true,
                errorMessage: friendlyMessage,
              }),
            }),
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
