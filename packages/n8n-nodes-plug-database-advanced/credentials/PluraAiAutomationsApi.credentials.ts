import type {
  Icon,
  IAuthenticateGeneric,
  ICredentialTestRequest,
  ICredentialType,
  INodeProperties,
} from "n8n-workflow";

export class PluraAiAutomationsApi implements ICredentialType {
  name = "pluraAiAutomationsApi";

  displayName = "Plura.ai Automations API";

  documentationUrl = "https://docs.plura.ai/";

  icon: Icon = "file:../nodes/PluraAiAutomationsTrigger/plura.svg";

  authenticate: IAuthenticateGeneric = {
    type: "generic",
    properties: {
      headers: {
        Authorization: "=Bearer {{ $credentials.apiKey }}",
      },
    },
  };

  test: ICredentialTestRequest = {
    request: {
      baseURL: "https://plura-lb.gynetix.com/backend/api",
      url: "/user/Authenticate.json",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: {
        user: "={{ $credentials.email }}",
        password: "={{ $credentials.password }}",
      },
    },
  };

  properties: INodeProperties[] = [
    {
      displayName: "Email",
      name: "email",
      type: "string",
      default: "",
      required: true,
      description: "Plura.ai account email.",
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
      description: "Plura.ai account password.",
    },
    {
      displayName: "API Key",
      name: "apiKey",
      type: "string",
      typeOptions: {
        password: true,
      },
      default: "",
      description: "Optional API key used as a bearer token for authenticated calls.",
    },
  ];
}
