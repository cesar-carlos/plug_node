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
    subtitle: '={{$parameter["operation"]}}',
    usableAsTool: true,
    icon: {
      light: "file:plugDatabaseClientAccess.svg",
      dark: "file:plugDatabaseClientAccess.dark.svg",
    },
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    return executePlugClientAccessNode(this, {
      credentialName: "plugDatabaseClientApi",
      nodeDisplayName: "Plug Database Client Access",
    });
  }
}
