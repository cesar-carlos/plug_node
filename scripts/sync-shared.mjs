import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const workspaceRoot = path.resolve(__dirname, "..");
const sharedRoot = path.join(workspaceRoot, "shared");
const packagesRoot = path.join(workspaceRoot, "packages");

const packageArgIndex = process.argv.indexOf("--package");
const requestedPackageName =
  packageArgIndex >= 0 ? process.argv[packageArgIndex + 1] : undefined;

if (!existsSync(sharedRoot)) {
  throw new Error(`Shared source directory not found: ${sharedRoot}`);
}

const allPackageNames = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const packageNames =
  requestedPackageName === undefined
    ? allPackageNames
    : allPackageNames.filter((packageName) => packageName === requestedPackageName);

if (packageNames.length === 0) {
  throw new Error(
    requestedPackageName === undefined
      ? "No workspace packages found under ./packages."
      : `Workspace package not found: ${requestedPackageName}`,
  );
}

for (const packageName of packageNames) {
  const targetRoot = path.join(packagesRoot, packageName, "generated", "shared");

  rmSync(targetRoot, { recursive: true, force: true });
  mkdirSync(targetRoot, { recursive: true });
  cpSync(sharedRoot, targetRoot, { recursive: true });

  if (packageName === "n8n-nodes-plug-client") {
    rmSync(path.join(targetRoot, "socket"), { recursive: true, force: true });
  }

  console.log(`Synced shared -> packages/${packageName}/generated/shared`);
}
