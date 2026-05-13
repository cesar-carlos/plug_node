import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "../..");
const nodeCommand = process.execPath;

const runSyncShared = (packageName: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const child = spawn(
      nodeCommand,
      ["scripts/sync-shared.mjs", "--package", packageName],
      {
        cwd: workspaceRoot,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve(stdout);
        return;
      }

      reject(new Error(stderr.trim() || `sync-shared exited with code ${code}`));
    });
  });

describe("shared sync boundaries", () => {
  it("syncs socket runtime code into the unified package", () => {
    const generatedShared = path.join(
      workspaceRoot,
      "packages/n8n-nodes-plug-database/generated/shared",
    );

    expect(existsSync(path.join(generatedShared, "socket"))).toBe(true);
    expect(existsSync(path.join(generatedShared, "contracts/payload-frame.ts"))).toBe(
      true,
    );
    expect(existsSync(path.join(generatedShared, "tools"))).toBe(true);
    expect(existsSync(path.join(generatedShared, "n8n/plugToolsDescription.ts"))).toBe(
      true,
    );
    expect(existsSync(path.join(generatedShared, "n8n/plugToolsExecution.ts"))).toBe(
      true,
    );
    expect(
      existsSync(path.join(generatedShared, "n8n/plugToolsSocketEventExecution.ts")),
    ).toBe(true);
  });

  it("serializes concurrent syncs for the same package without leftover lock or temp directories", async () => {
    const packageName = "n8n-nodes-plug-database";
    const generatedRoot = path.join(workspaceRoot, "packages", packageName, "generated");

    const outputs = await Promise.all([
      runSyncShared(packageName),
      runSyncShared(packageName),
    ]);
    const generatedEntries = readdirSync(generatedRoot);

    expect(outputs.join("\n")).toContain(
      "Synced shared -> packages/n8n-nodes-plug-database/generated/shared",
    );
    expect(existsSync(path.join(generatedRoot, "shared"))).toBe(true);
    expect(generatedEntries.some((entry) => entry.includes(".shared-sync.lock"))).toBe(
      false,
    );
    expect(generatedEntries.some((entry) => entry.startsWith(".shared-"))).toBe(false);
  });
});
