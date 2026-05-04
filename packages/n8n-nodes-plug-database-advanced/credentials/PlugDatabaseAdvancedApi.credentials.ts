import type {
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

import { DEFAULT_BASE_URL } from "../generated/shared/contracts/api";

export class PlugDatabaseAdvancedApi implements ICredentialType {
  name = "plugDatabaseAdvancedApi";

  displayName = "Plug Database Advanced API";

  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";

  icon: Icon = {
    light: "file:../nodes/PlugDatabaseAdvanced/plugDatabaseAdvanced.svg",
    dark: "file:../nodes/PlugDatabaseAdvanced/plugDatabaseAdvanced.dark.svg",
  };

  properties: INodeProperties[] = [
    {
      displayName: "User (email)",
      name: "user",
      type: "string",
      default: "",
      required: true,
      placeholder: "user@example.com",
      description:
        "The Plug account email used by the consolidated Plug Database Advanced node.",
    },
    {
      displayName: "Password",
      name: "password",
      type: "string",
      typeOptions: {
        password: true,
      },
      default: "",
      required: true,
      description:
        "The Plug account password used by the consolidated Plug Database Advanced node.",
    },
    {
      displayName: "Default Agent ID",
      name: "agentId",
      type: "string",
      default: "",
      description:
        "Optional default Plug agent identifier used by SQL operations when the node does not override Agent ID.",
    },
    {
      displayName: "Default Client Token",
      name: "clientToken",
      type: "string",
      typeOptions: {
        password: true,
      },
      default: "",
      description:
        "Optional default client token used by SQL operations when the node does not override Client Token.",
    },
  ];

  test: ICredentialTestRequest = {
    request: {
      method: "POST",
      baseURL: DEFAULT_BASE_URL,
      url: "/client-auth/login",
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        email: "={{$credentials.user}}",
        password: "={{$credentials.password}}",
      },
    },
  };
}
