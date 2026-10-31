import type { ICredentialType, INodeProperties, Icon } from "n8n-workflow";

export class PlugAgentApi implements ICredentialType {
  name = "plugAgentApi";
  displayName = "Plug Agent API";
  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";
  icon: Icon = {
    light: "file:../nodes/PlugDatabase/plugDatabaseV2.svg",
    dark: "file:../nodes/PlugDatabase/plugDatabaseV2.dark.svg",
  };
  properties: INodeProperties[] = [
    {
      displayName: "Agent ID",
      name: "agentId",
      type: "string",
      default: "",
      required: true,
    },
    {
      displayName: "Local Client Token",
      name: "clientToken",
      type: "string",
      typeOptions: { password: true },
      default: "",
      required: true,
      description:
        "Current credential provisioned locally on the agent. Separate from Hub login; requires the selected operation scopes.",
    },
  ];
}
