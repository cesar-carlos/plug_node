import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { PlugDatabaseAccountApi as AdvancedPlugDatabaseAccountApi } from "../../packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAccountApi.credentials";
import { PlugDatabaseAccountApi as PublicPlugDatabaseAccountApi } from "../../packages/n8n-nodes-plug-database/credentials/PlugDatabaseAccountApi.credentials";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(
    readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8"),
  ) as T;

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
    ]);
    expect(publicManifest.n8n.nodes).toEqual([
      "dist/nodes/PlugDatabase/PlugDatabase.node.js",
    ]);
    expect(advancedManifest.n8n.credentials).toEqual([
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
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
});
