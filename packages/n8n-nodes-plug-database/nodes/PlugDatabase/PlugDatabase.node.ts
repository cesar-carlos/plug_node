import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugClientNodeDescription } from "../../generated/shared/n8n/plugClientDescription";
import { executePlugClientNode } from "../../generated/shared/n8n/plugClientExecution";

export class PlugDatabase implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugClientNodeDescription({
      supportsSocket: false,
      displayName: "Plug Database",
      technicalName: "plugDatabase",
      credentialName: "plugDatabaseApi",
      iconBaseName: "plugDatabase",
      description: "Run Plug Database commands over REST.",
    }),
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabase.svg",
      dark: "file:plugDatabase.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugClientNode(this, {
        supportsSocket: false,
        credentialName: "plugDatabaseApi",
        nodeDisplayName: "Plug Database",
      });
    } catch (error: unknown) {
      if (this.continueOnFail()) {
        return [
          [
            {
              json: {
                error:
                  error instanceof Error ? error.message : "Unknown Plug Database error",
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
