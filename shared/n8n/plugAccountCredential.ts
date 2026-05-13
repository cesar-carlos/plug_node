import type { ICredentialTestRequest, INodeProperties } from "n8n-workflow";

import { DEFAULT_BASE_URL } from "../contracts/api";

export const plugDatabaseAccountCredentialName = "plugDatabaseAccountApi";
export const plugDatabaseAccountCredentialDisplayName = "Plug Database Account API";
export const plugDatabaseAccountCredentialDocumentationUrl =
  "https://plug-server.se7esistemassinop.com.br/docs";

export const plugDatabaseAccountCredentialProperties: INodeProperties[] = [
  {
    displayName: "User (email)",
    name: "user",
    type: "string",
    default: "",
    required: true,
    placeholder: "user@example.com",
    description: "The Plug account email used by authenticated Plug nodes.",
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
    description: "The Plug account password used by authenticated Plug nodes.",
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
  {
    displayName: "Payload Signing Key",
    name: "payloadSigningKey",
    type: "string",
    typeOptions: {
      password: true,
    },
    default: "",
    description:
      "Optional shared HMAC-SHA256 key used to sign and verify Socket PayloadFrame messages.",
  },
  {
    displayName: "Payload Signing Key ID",
    name: "payloadSigningKeyId",
    type: "string",
    typeOptions: {
      password: true,
    },
    default: "",
    description:
      "Optional key identifier sent as PayloadFrame signature.key_id and required when verifying signed frames.",
  },
];

export const plugDatabaseAccountCredentialTest: ICredentialTestRequest = {
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
