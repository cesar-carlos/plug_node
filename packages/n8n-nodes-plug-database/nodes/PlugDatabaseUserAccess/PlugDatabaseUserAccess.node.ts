import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugUserAccessNodeDescription } from "../../generated/shared/n8n/plugUserAccessDescription";
import { executePlugUserAccessNode } from "../../generated/shared/n8n/plugUserAccessExecution";

export class PlugDatabaseUserAccess implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugUserAccessNodeDescription({
      displayName: "Plug Database User Access",
      technicalName: "plugDatabaseUserAccess",
      credentialName: "plugDatabaseUserApi",
      iconBaseName: "plugDatabaseUserAccess",
      description:
        "Browse the Plug agent catalog and manage client access approvals over REST.",
    }),
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseUserAccess.svg",
      dark: "file:plugDatabaseUserAccess.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    try {
      return await executePlugUserAccessNode(this, {
        credentialName: "plugDatabaseUserApi",
        nodeDisplayName: "Plug Database User Access",
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
                    : "Unknown Plug Database User Access error",
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
