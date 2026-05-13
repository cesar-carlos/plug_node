import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PlugDatabaseAdvancedApi as AdvancedPlugDatabaseAdvancedApi } from "../../packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAdvancedApi.credentials";
import { PlugDatabaseAccountApi as AdvancedPlugDatabaseAccountApi } from "../../packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAccountApi.credentials";
import { PlugDatabaseApi as AdvancedPlugDatabaseApi } from "../../packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseApi.credentials";
import { PlugDatabaseClientApi as AdvancedPlugDatabaseClientApi } from "../../packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseClientApi.credentials";
import { PlugDatabaseUserApi as AdvancedPlugDatabaseUserApi } from "../../packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseUserApi.credentials";
import { PlugDatabaseAdvancedApi as PublicPlugDatabaseAdvancedApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseAdvancedApi.credentials";
import { PlugDatabaseAccountApi as PublicPlugDatabaseAccountApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseAccountApi.credentials";
import { PlugDatabaseApi as PublicPlugDatabaseApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseApi.credentials";
import { PlugDatabaseClientApi as PublicPlugDatabaseClientApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseClientApi.credentials";
import { PlugDatabaseUserApi as PublicPlugDatabaseUserApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseUserApi.credentials";

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
}

type CredentialConstructor = new () => CredentialContract;

describe("published Plug package surface", () => {
  it("publishes only the shared Plug account credential and supported nodes", () => {
    const publicManifest = readJson<{
      readonly n8n: { readonly credentials: string[]; readonly nodes: string[] };
    }>("packages/n8n-nodes-plug-database/package.json");
    const advancedManifest = readJson<{
      readonly n8n: { readonly credentials: string[]; readonly nodes: string[] };
    }>("packages/n8n-nodes-plug-database-advanced/package.json");

    expect(publicManifest.n8n.credentials).toEqual([
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
      ...legacyCredentialPaths,
    ]);
    expect(publicManifest.n8n.nodes).toEqual([
      "dist/nodes/PlugDatabase/PlugDatabase.node.js",
    ]);
    expect(advancedManifest.n8n.credentials).toEqual([
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
      ...legacyCredentialPaths,
      "dist/credentials/PluraAiAutomationsApi.credentials.js",
    ]);
    expect(advancedManifest.n8n.nodes).toEqual([
      "dist/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node.js",
      "dist/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node.js",
      "dist/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node.js",
      "dist/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node.js",
      "dist/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node.js",
    ]);
  });

  it("keeps the shared Plug account credential contract aligned across packages", () => {
    const publicCredential = new PublicPlugDatabaseAccountApi();
    const advancedCredential = new AdvancedPlugDatabaseAccountApi();

    expect(publicCredential.name).toBe("plugDatabaseAccountApi");
    expect(advancedCredential.name).toBe("plugDatabaseAccountApi");
    expect(publicCredential.displayName).toBe("Plug Database Account API");
    expect(advancedCredential.displayName).toBe("Plug Database Account API");
    expect(publicCredential.documentationUrl).toBe(advancedCredential.documentationUrl);
    expect(publicCredential.properties).toEqual(advancedCredential.properties);
    expect(publicCredential.test).toEqual(advancedCredential.test);
  });

  it("keeps legacy Plug credential aliases selectable through the shared account credential", () => {
    const publicAccountCredential = new PublicPlugDatabaseAccountApi();
    const advancedAccountCredential = new AdvancedPlugDatabaseAccountApi();
    const aliases: Array<{
      readonly name: string;
      readonly publicCredential: CredentialConstructor;
      readonly advancedCredential: CredentialConstructor;
    }> = [
      {
        name: "plugDatabaseApi",
        publicCredential: PublicPlugDatabaseApi,
        advancedCredential: AdvancedPlugDatabaseApi,
      },
      {
        name: "plugDatabaseAdvancedApi",
        publicCredential: PublicPlugDatabaseAdvancedApi,
        advancedCredential: AdvancedPlugDatabaseAdvancedApi,
      },
      {
        name: "plugDatabaseClientApi",
        publicCredential: PublicPlugDatabaseClientApi,
        advancedCredential: AdvancedPlugDatabaseClientApi,
      },
      {
        name: "plugDatabaseUserApi",
        publicCredential: PublicPlugDatabaseUserApi,
        advancedCredential: AdvancedPlugDatabaseUserApi,
      },
    ];

    for (const alias of aliases) {
      const publicCredential = new alias.publicCredential();
      const advancedCredential = new alias.advancedCredential();

      expect(publicCredential.name).toBe(alias.name);
      expect(advancedCredential.name).toBe(alias.name);
      expect(publicCredential.extends).toEqual(["plugDatabaseAccountApi"]);
      expect(advancedCredential.extends).toEqual(["plugDatabaseAccountApi"]);
      expect(publicCredential.properties).toEqual([]);
      expect(advancedCredential.properties).toEqual([]);
      expect(publicCredential.test).toBe(publicAccountCredential.test);
      expect(advancedCredential.test).toBe(advancedAccountCredential.test);
    }
  });
});
