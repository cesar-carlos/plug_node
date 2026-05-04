import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugClientAccessNodeDescription } from "../../generated/shared/n8n/plugClientAccessDescription";
import { executePlugClientAccessNode } from "../../generated/shared/n8n/plugClientAccessExecution";

export class PlugDatabaseClientAccess implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugClientAccessNodeDescription({
      displayName: "Plug Database Client Access",
      technicalName: "plugDatabaseClientAccess",
      credentialName: "plugDatabaseClientApi",
      iconBaseName: "plugDatabaseClientAccess",
      description: "Manage client-to-agent access and client tokens over REST.",
    }),
    hidden: true,
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseClientAccess.svg",
      dark: "file:plugDatabaseClientAccess.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugClientAccessNode(this, {
        credentialName: "plugDatabaseClientApi",
        nodeDisplayName: "Plug Database Client Access",
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
                    : "Unknown Plug Database Client Access error",
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
