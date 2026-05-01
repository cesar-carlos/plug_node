import type {
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

import { DEFAULT_BASE_URL } from "../generated/shared/contracts/api";

export class PlugClientApi implements ICredentialType {
  name = "plugClientApi";

  displayName = "Plug Client API";

  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";

  icon: Icon = {
    light: "file:../nodes/PlugClient/plugClient.svg",
    dark: "file:../nodes/PlugClient/plugClient.dark.svg",
  };

  properties: INodeProperties[] = [
    {
      displayName: "User (email)",
      name: "user",
      type: "string",
      default: "",
      required: true,
      placeholder: "client@example.com",
      description: "The Plug client login email.",
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
      description: "The Plug client password.",
    },
    {
      displayName: "Agent ID",
      name: "agentId",
      type: "string",
      default: "",
      required: true,
      description: "The Plug agent identifier used for every command in this node.",
    },
    {
      displayName: "Client Token",
      name: "clientToken",
      type: "string",
      typeOptions: {
        password: true,
      },
      default: "",
      required: true,
      description: "The client token injected into supported Plug commands.",
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
