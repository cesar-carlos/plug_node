import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugClientAccessNodeDescription } from "../../generated/shared/n8n/plugClientAccessDescription";
import { executePlugClientAccessNode } from "../../generated/shared/n8n/plugClientAccessExecution";

export class PlugDatabaseAdvancedClientAccess implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugClientAccessNodeDescription({
      displayName: "Plug Database Advanced Client Access",
      technicalName: "plugDatabaseAdvancedClientAccess",
      credentialName: "plugDatabaseAdvancedClientApi",
      iconBaseName: "plugDatabaseAdvancedClientAccess",
      description: "Manage client-to-agent access and client tokens over REST.",
    }),
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseAdvancedClientAccess.svg",
      dark: "file:plugDatabaseAdvancedClientAccess.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugClientAccessNode(this, {
        credentialName: "plugDatabaseAdvancedClientApi",
        nodeDisplayName: "Plug Database Advanced Client Access",
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
                    : "Unknown Plug Database Advanced Client Access error",
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
