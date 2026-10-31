import { toNodeExecutionError } from "../../generated/shared/n8n/nodeExecutionError";
import type {
  IExecuteFunctions,
  ILoadOptionsFunctions,
  INodeExecutionData,
  INodePropertyOptions,
  INodeType,
  INodeTypeDescription,
  ResourceMapperFields,
} from "n8n-workflow";
import { buildMcpServerNodeDescription } from "../../generated/shared/n8n/mcpServerDescription";
import { executeMcpServerNode } from "../../generated/shared/n8n/mcpServerExecution";
import { serializeErrorForContinueOnFail } from "../../generated/shared/output/errorOutput";
import {
  loadCapabilityNameOptions,
  loadCapabilityParamResourceMapperFields,
} from "../../generated/shared/n8n/mcpServerHelpers";
import { createSocketCommandExecutor } from "../PlugDatabase/socketCommandExecutor";
import { createRelaySocketExecutorForNode } from "../PlugDatabase/socketRelayExecutor";
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
    const relay = createRelaySocketExecutorForNode();
    const command = createSocketCommandExecutor(relay.execute);
    try {
      return await executeMcpServerNode(this, {
        supportsSocket: true,
        credentialName: "plugDatabaseAccountApi",
        nodeDisplayName: "Plug MCP Server",
        socketExecutor: command.execute,
        legacySocketExecutor: relay.execute,
      });
    } catch (error: unknown) {
      if (this.continueOnFail()) {
        return [
          [
            {
              json: { error: serializeErrorForContinueOnFail(error) },
              pairedItem: { item: 0 },
            },
          ],
        ];
      }
      throw toNodeExecutionError(this.getNode(), error, 0);
    } finally {
      command.close();
      relay.close();
    }
  }
}
