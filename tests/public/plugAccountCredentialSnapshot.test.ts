import { describe, expect, it } from "vitest";

import { PlugDatabaseAccountApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseAccountApi.credentials";

describe("Plug account credential snapshot", () => {
  it("keeps the shared credential property contract stable", () => {
    const credential = new PlugDatabaseAccountApi();

    expect(credential.properties).toMatchInlineSnapshot(`
      [
        {
          "default": "",
          "description": "The Plug account email used by authenticated Plug nodes.",
          "displayName": "User (email)",
          "name": "user",
          "placeholder": "user@example.com",
          "required": true,
          "type": "string",
        },
        {
          "default": "",
          "description": "The Plug account password used by authenticated Plug nodes.",
          "displayName": "Password",
          "name": "password",
          "required": true,
          "type": "string",
          "typeOptions": {
            "password": true,
          },
        },
        {
          "default": "",
          "description": "Optional default Plug agent identifier used by SQL operations when the node does not override Agent ID.",
          "displayName": "Default Agent ID",
          "name": "agentId",
          "type": "string",
        },
        {
          "default": "",
          "description": "Optional default client token used by SQL operations when the node does not override Client Token.",
          "displayName": "Default Client Token",
          "name": "clientToken",
          "type": "string",
          "typeOptions": {
            "password": true,
          },
        },
        {
          "default": "",
          "description": "Optional shared HMAC-SHA256 key used to sign and verify Socket PayloadFrame messages.",
          "displayName": "Payload Signing Key",
          "name": "payloadSigningKey",
          "type": "string",
          "typeOptions": {
            "password": true,
          },
        },
        {
          "default": "",
          "description": "Optional key identifier sent as PayloadFrame signature.key_id and required when verifying signed frames.",
          "displayName": "Payload Signing Key ID",
          "name": "payloadSigningKeyId",
          "type": "string",
          "typeOptions": {
            "password": true,
          },
        },
        {
          "default": "",
          "description": "Optional JSON array of previous HMAC signing keys for key rotation, e.g. [{"key":"...","keyId":"old-key-1"}].",
          "displayName": "Payload Signing Previous Keys JSON",
          "name": "payloadSigningPreviousKeysJson",
          "type": "string",
          "typeOptions": {
            "password": true,
          },
        },
      ]
    `);
    expect(credential.test).toMatchInlineSnapshot(`
      {
        "request": {
          "baseURL": "https://plug-server.se7esistemassinop.com.br/api/v1",
          "body": {
            "email": "={{$credentials.user}}",
            "password": "={{$credentials.password}}",
          },
          "headers": {
            "Content-Type": "application/json",
          },
          "method": "POST",
          "url": "/client-auth/login",
        },
      }
    `);
  });
});
