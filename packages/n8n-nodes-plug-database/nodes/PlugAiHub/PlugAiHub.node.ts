import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildSystemPrompt } from "../../generated/shared/mcp/systemPrompt";
import { buildAiHubNodeDescription } from "../../generated/shared/n8n/aiHubDescription";
import { serializeErrorForContinueOnFail } from "../../generated/shared/output/errorOutput";
import { readForbiddenCapabilityNames, readSystemPromptConfig } from "./aiHubHelpers";

const toOutputItem = (json: IDataObject, itemIndex = 0): INodeExecutionData => ({
  json,
  pairedItem: { item: itemIndex },
});

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- AI Hub emits prompt configuration; it is not a database tool.
export class PlugAiHub implements INodeType {
  description: INodeTypeDescription = {
    ...buildAiHubNodeDescription({
      displayName: "Plug AI Hub",
      technicalName: "plugAiHub",
      iconBaseName: "plugDatabaseV2",
      description:
        "Build the governed system prompt and AI behavior configuration for Plug MCP workflows.",
    }),
    subtitle: "AI Hub",
    icon: {
      light: "file:plugDatabaseV2.svg",
      dark: "file:plugDatabaseV2.dark.svg",
    },
    codex: {
      alias: ["Plug AI", "AI Hub", "ERP Assistant", "Plug MCP Hub"],
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const itemCount = Math.max(items.length, 1);
    const returnData: INodeExecutionData[] = [];

    for (let itemIndex = 0; itemIndex < itemCount; itemIndex += 1) {
      try {
        const promptConfig = readSystemPromptConfig(this, itemIndex);
        const forbiddenCapabilityNames = readForbiddenCapabilityNames(this, itemIndex);
        const systemPrompt = buildSystemPrompt(promptConfig);

        returnData.push(
          toOutputItem(
            {
              systemPrompt,
              maxToolCallsPerTurn: promptConfig.maxToolCallsPerTurn,
              forbiddenCapabilityNames,
            },
            itemIndex,
          ),
        );
      } catch (error: unknown) {
        if (this.continueOnFail()) {
          returnData.push(
            toOutputItem(
              {
                error: serializeErrorForContinueOnFail(error),
              },
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
}
