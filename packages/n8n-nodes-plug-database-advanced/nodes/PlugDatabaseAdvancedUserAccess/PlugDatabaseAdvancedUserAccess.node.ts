import type {
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
} from "n8n-workflow";

import { buildPlugUserAccessNodeDescription } from "../../generated/shared/n8n/plugUserAccessDescription";
import { executePlugUserAccessNode } from "../../generated/shared/n8n/plugUserAccessExecution";

export class PlugDatabaseAdvancedUserAccess implements INodeType {
  description: INodeTypeDescription = {
    ...buildPlugUserAccessNodeDescription({
      displayName: "Plug Database Advanced User Access",
      technicalName: "plugDatabaseAdvancedUserAccess",
      credentialName: "plugDatabaseAdvancedUserApi",
      iconBaseName: "plugDatabaseAdvancedUserAccess",
      description:
        "Browse the Plug agent catalog and manage client access approvals over REST.",
    }),
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseAdvancedUserAccess.svg",
      dark: "file:plugDatabaseAdvancedUserAccess.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executePlugUserAccessNode(this, {
      credentialName: "plugDatabaseAdvancedUserApi",
      nodeDisplayName: "Plug Database Advanced User Access",
    });
  }
}
