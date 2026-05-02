import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugClientNodeDescription } from "../../generated/shared/n8n/plugClientDescription";
import { executePlugClientNode } from "../../generated/shared/n8n/plugClientExecution";
import { executeSocketCommand } from "./socketRelayExecutor";

export class PlugDatabaseAdvanced implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugClientNodeDescription({
      supportsSocket: true,
      displayName: "Plug Database Advanced",
      technicalName: "plugDatabaseAdvanced",
      credentialName: "plugDatabaseAdvancedApi",
      iconBaseName: "plugDatabaseAdvanced",
      description: "Run Plug Database commands over REST or Socket relay.",
    }),
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseAdvanced.svg",
      dark: "file:plugDatabaseAdvanced.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugClientNode(this, {
        supportsSocket: true,
        credentialName: "plugDatabaseAdvancedApi",
        nodeDisplayName: "Plug Database Advanced",
        socketExecutor: executeSocketCommand,
      });
    } catch (error: unknown) {
      if (this.continueOnFail()) {
        return [
          [
            {
              json: {
                error:
                  error instanceof Error
                    ? error.message
                    : "Unknown Plug Database Advanced error",
              },
              pairedItem: {
                item: 0,
              },
            },
          ],
        ];
      }

      throw error;
    }
  }
}
