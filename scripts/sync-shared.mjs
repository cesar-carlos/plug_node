import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from "node:fs";
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

const sleepSync = (durationMs) => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, durationMs);
};

const acquireLock = (lockDir) => {
  const deadline = Date.now() + 60_000;

  while (true) {
    try {
      mkdirSync(lockDir);
      return () => rmSync(lockDir, { recursive: true, force: true });
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      if (Date.now() > deadline) {
        throw new Error(`Timed out waiting for sync lock: ${lockDir}`);
      }

      sleepSync(100);
    }
  }
};

for (const packageName of packageNames) {
  const targetRoot = path.join(packagesRoot, packageName, "generated", "shared");
  const targetParent = path.dirname(targetRoot);
  const lockDir = path.join(targetParent, ".shared-sync.lock");
  const tempRoot = path.join(
    targetParent,
    `.shared-${packageName}-${process.pid}-${Date.now()}`,
  );
  mkdirSync(targetParent, { recursive: true });
  const releaseLock = acquireLock(lockDir);

  try {
    rmSync(tempRoot, { recursive: true, force: true });
    mkdirSync(tempRoot, { recursive: true });
    cpSync(sharedRoot, tempRoot, { recursive: true });

    if (packageName === "n8n-nodes-plug-database") {
      rmSync(path.join(tempRoot, "contracts", "payload-frame.ts"), {
        force: true,
      });
      rmSync(path.join(tempRoot, "socket"), { recursive: true, force: true });
    }

    rmSync(targetRoot, { recursive: true, force: true });
    renameSync(tempRoot, targetRoot);
    console.log(`Synced shared -> packages/${packageName}/generated/shared`);
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
    releaseLock();
  }
}
