import { describe, expect, it } from "vitest";
import { ESLint } from "eslint";
import { fileURLToPath } from "node:url";
import { validateRuntimeDependencies } from "../../scripts/runtime-dependency-policy.mjs";

describe("self-hosted dependency policy", () => {
  it("should permit reviewed libraries with exact stable versions", () => {
    expect(() =>
      validateRuntimeDependencies({ sharp: "0.35.5", zod4: "npm:zod@4.6.7" }),
    ).not.toThrow();
  });
  it("should reject unreviewed runtime libraries", () => {
    expect(() => validateRuntimeDependencies({ express: "5.0.0" })).toThrow("Unreviewed");
  });
  it.each([
    "latest",
    "^0.35.5",
    "0.36.0-beta.1",
    "file:../local",
    "https://example.com/package.tgz",
  ])("should reject unpinned or unstable version %s", (version) => {
    expect(() => validateRuntimeDependencies({ sharp: version })).toThrow(
      "exact stable version",
    );
  });
  // Loading the full upstream ESLint graph is slower under V8 coverage on Windows.
  it("should enforce n8n error wrapping at node boundaries while allowing typed core errors", async () => {
    const cwd = fileURLToPath(
      new URL("../../packages/n8n-nodes-plug-database/", import.meta.url),
    );
    const eslint = new ESLint({ cwd });
    const node = await eslint.calculateConfigForFile(
      `${cwd}/nodes/PlugDatabase/PlugDatabase.node.ts`,
    );
    const helper = await eslint.calculateConfigForFile(
      `${cwd}/generated/shared/auth/session.ts`,
    );
    expect(node.rules["@n8n/community-nodes/require-node-api-error"][0]).toBe(2);
    expect(helper.rules["@n8n/community-nodes/require-node-api-error"][0]).toBe(0);
    expect(helper.rules["@n8n/community-nodes/no-hardcoded-secrets"][0]).toBe(2);
    const agentCredential = await eslint.calculateConfigForFile(
      `${cwd}/credentials/PlugAgentApi.credentials.ts`,
    );
    const accountCredential = await eslint.calculateConfigForFile(
      `${cwd}/credentials/PlugDatabaseAccountApi.credentials.ts`,
    );
    expect(
      agentCredential.rules["@n8n/community-nodes/credential-test-required"][0],
    ).toBe(0);
    expect(
      accountCredential.rules["@n8n/community-nodes/credential-test-required"][0],
    ).toBe(2);
  }, 30_000);
});
