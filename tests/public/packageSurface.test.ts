import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PlugDatabaseAdvancedApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseAdvancedApi.credentials";
import { PlugDatabaseAccountApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseAccountApi.credentials";
import { PlugDatabaseApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseApi.credentials";
import { PlugDatabaseClientApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseClientApi.credentials";
import { PlugDatabaseUserApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseUserApi.credentials";
import { PluraAiAutomationsApi } from "../../packages/n8n-nodes-plug-database/credentials/PluraAiAutomationsApi.credentials";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
  ) as T;

const legacyCredentialPaths = [
  "dist/credentials/PlugDatabaseApi.credentials.js",
  "dist/credentials/PlugDatabaseAdvancedApi.credentials.js",
  "dist/credentials/PlugDatabaseClientApi.credentials.js",
  "dist/credentials/PlugDatabaseUserApi.credentials.js",
];

interface CredentialContract {
  readonly name: string;
  readonly displayName: string;
  readonly extends?: string[];
  readonly properties: unknown[];
  readonly test: unknown;
  readonly __skipManagedCreation?: boolean;
}

type CredentialConstructor = new () => CredentialContract;

describe("published Plug package surface", () => {
  it("publishes the unified Plug package surface", () => {
    const manifest = readJson<{
      readonly n8n: { readonly credentials: string[]; readonly nodes: string[] };
    }>("packages/n8n-nodes-plug-database/package.json");

    expect(manifest.n8n.credentials).toEqual([
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
      ...legacyCredentialPaths,
      "dist/credentials/PluraAiAutomationsApi.credentials.js",
    ]);
    expect(manifest.n8n.nodes).toEqual([
      "dist/nodes/PlugDatabase/PlugDatabase.node.js",
      "dist/nodes/PlugMcpServer/PlugMcpServer.node.js",
      "dist/nodes/PlugAiHub/PlugAiHub.node.js",
      "dist/nodes/PlugDatabaseSocketEventTrigger/PlugDatabaseSocketEventTrigger.node.js",
      "dist/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node.js",
    ]);
  });

  it("keeps the shared Plug account credential contract", () => {
    const credential = new PlugDatabaseAccountApi();

    expect(credential.name).toBe("plugDatabaseAccountApi");
    expect(credential.displayName).toBe("Plug Database Account API");
    expect(credential.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "user" }),
        expect.objectContaining({ name: "password" }),
        expect.objectContaining({ name: "agentId" }),
        expect.objectContaining({ name: "clientToken" }),
      ]),
    );
  });

  it("keeps legacy Plug credential aliases selectable through the shared account credential", () => {
    const accountCredential = new PlugDatabaseAccountApi();
    const aliases: Array<{
      readonly name: string;
      readonly credential: CredentialConstructor;
    }> = [
      { name: "plugDatabaseApi", credential: PlugDatabaseApi },
      { name: "plugDatabaseAdvancedApi", credential: PlugDatabaseAdvancedApi },
      { name: "plugDatabaseClientApi", credential: PlugDatabaseClientApi },
      { name: "plugDatabaseUserApi", credential: PlugDatabaseUserApi },
    ];

    for (const alias of aliases) {
      const credential = new alias.credential();

      expect(credential.name).toBe(alias.name);
      expect(credential.extends).toEqual(["plugDatabaseAccountApi"]);
      expect(credential.properties).toEqual([]);
      expect(credential.test).toBe(accountCredential.test);
      expect(credential.__skipManagedCreation).toBe(true);
    }
  });

  it("publishes the Plura.ai credential in the unified package", () => {
    const credential = new PluraAiAutomationsApi();

    expect(credential.name).toBe("pluraAiAutomationsApi");
    expect(credential.displayName).toBe("Plura.ai Automations API");
    expect(credential.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "email" }),
        expect.objectContaining({ name: "password" }),
        expect.objectContaining({ name: "apiKey" }),
      ]),
    );
  });
});
