import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");

describe("shared sync boundaries", () => {
  it("keeps tool runtime code out of the public package generated shared copy", () => {
    const publicGeneratedShared = path.join(
      workspaceRoot,
      "packages/n8n-nodes-plug-database/generated/shared",
    );

    expect(existsSync(path.join(publicGeneratedShared, "tools"))).toBe(false);
    expect(
      existsSync(path.join(publicGeneratedShared, "n8n/plugToolsDescription.ts")),
    ).toBe(false);
    expect(
      existsSync(path.join(publicGeneratedShared, "n8n/plugToolsExecution.ts")),
    ).toBe(false);
  });
});
