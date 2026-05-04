import type {
  Icon,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

import { DEFAULT_BASE_URL } from "../generated/shared/contracts/api";

export class PlugDatabaseClientApi implements ICredentialType {
  name = "plugDatabaseClientApi";

  displayName = "Plug Database Client API";

  documentationUrl = "https://plug-server.se7esistemassinop.com.br/docs";

  icon: Icon = {
    light: "file:../nodes/PlugDatabaseClientAccess/plugDatabaseClientAccess.svg",
    dark: "file:../nodes/PlugDatabaseClientAccess/plugDatabaseClientAccess.dark.svg",
  };

  properties: INodeProperties[] = [
    {
      displayName: "User (email)",
      name: "user",
      type: "string",
      default: "",
      required: true,
      placeholder: "client@example.com",
      description: "The Plug Database client login email.",
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
      description: "The Plug Database client password.",
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
