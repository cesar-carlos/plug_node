import type {
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

import { DEFAULT_BASE_URL } from "../generated/shared/contracts/api";

export class PlugDatabaseUserApi implements ICredentialType {
  name = "plugDatabaseUserApi";

  displayName = "Plug Database User API";

  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";

  icon: Icon = {
    light: "file:../nodes/PlugDatabaseUserAccess/plugDatabaseUserAccess.svg",
    dark: "file:../nodes/PlugDatabaseUserAccess/plugDatabaseUserAccess.dark.svg",
  };

  properties: INodeProperties[] = [
    {
      displayName: "User (email)",
      name: "user",
      type: "string",
      default: "",
      required: true,
      placeholder: "owner@example.com",
      description: "The Plug Database user login email.",
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
      description: "The Plug Database user password.",
    },
  ];

  test: ICredentialTestRequest = {
    request: {
      method: "POST",
      baseURL: DEFAULT_BASE_URL,
      url: "/auth/login",
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
