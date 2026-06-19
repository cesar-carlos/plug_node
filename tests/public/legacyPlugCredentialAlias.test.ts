import { describe, expect, it } from "vitest";

import {
  plugDatabaseAccountCredentialName,
  plugDatabaseAccountCredentialTest,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugAccountCredential";
import { createLegacyPlugCredentialAlias } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/legacyPlugCredentialAlias";

describe("createLegacyPlugCredentialAlias", () => {
  it("extends the shared Plug account credential", () => {
    const alias = createLegacyPlugCredentialAlias({
      name: "plugDatabaseApi",
      displayName: "Plug Database API",
      icon: "file:plug.svg",
    });

    expect(alias.extends).toEqual([plugDatabaseAccountCredentialName]);
  });

  it("marks __skipManagedCreation and exposes empty properties", () => {
    const alias = createLegacyPlugCredentialAlias({
      name: "plugDatabaseApi",
      displayName: "Plug Database API",
      icon: "file:plug.svg",
    });

    expect(alias.__skipManagedCreation).toBe(true);
    expect(alias.properties).toEqual([]);
  });

  it("reuses the shared account credential test request", () => {
    const alias = createLegacyPlugCredentialAlias({
      name: "plugDatabaseApi",
      displayName: "Plug Database API",
      icon: "file:plug.svg",
    });

    expect(alias.test).toBe(plugDatabaseAccountCredentialTest);
  });

  it("preserves caller-supplied identity fields", () => {
    const alias = createLegacyPlugCredentialAlias({
      name: "plugDatabaseUserApi",
      displayName: "Plug Database User API",
      icon: { light: "file:user.svg", dark: "file:user.dark.svg" },
    });

    expect(alias.name).toBe("plugDatabaseUserApi");
    expect(alias.displayName).toBe("Plug Database User API");
    expect(alias.icon).toEqual({ light: "file:user.svg", dark: "file:user.dark.svg" });
  });
});
