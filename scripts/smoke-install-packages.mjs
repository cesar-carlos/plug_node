import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { plugPackageSurface } from "./package-surface.config.mjs";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const rootDir = process.cwd();
const tempRoot = mkdtempSync(path.join(os.tmpdir(), "plug-node-smoke-install-"));

const run = (args, cwd) => {
  const result = spawnSync(npmCommand, args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(stderr === "" ? `npm ${args.join(" ")} failed` : stderr);
  }

  return typeof result.stdout === "string" ? result.stdout.trim() : "";
};

try {
  const tarballDir = path.join(tempRoot, "tarballs");
  const installDir = path.join(tempRoot, "install");
  mkdirSync(tarballDir, { recursive: true });
  mkdirSync(installDir, { recursive: true });

  for (const pkg of plugPackageSurface) {
    const packOutput = run(
      ["pack", "--json", "--workspace", pkg.workspace, "--pack-destination", tarballDir],
      rootDir,
    );
    const parsed = JSON.parse(packOutput);
    const tarballName = parsed[0]?.filename;
    if (typeof tarballName !== "string" || tarballName.trim() === "") {
      throw new Error(`Unexpected npm pack output for ${pkg.workspace}`);
    }

    const packageInstallDir = path.join(installDir, pkg.packageName);
    mkdirSync(packageInstallDir, { recursive: true });
    writeFileSync(
      path.join(packageInstallDir, "package.json"),
      JSON.stringify({ name: "plug-smoke-install", private: true }, null, 2),
      "utf8",
    );

    run(
      [
        "install",
        "--no-package-lock",
        "--ignore-scripts",
        path.join(tarballDir, tarballName),
        "n8n-workflow@2.16.0",
      ],
      packageInstallDir,
    );

    const installedPackageJson = JSON.parse(
      readFileSync(
        path.join(packageInstallDir, "node_modules", pkg.packageName, "package.json"),
        "utf8",
      ),
    );

    if (
      JSON.stringify(installedPackageJson.n8n.credentials) !==
        JSON.stringify(pkg.manifest.credentials) ||
      JSON.stringify(installedPackageJson.n8n.nodes) !==
        JSON.stringify(pkg.manifest.nodes)
    ) {
      throw new Error(`Installed manifest mismatch for ${pkg.packageName}`);
    }

    for (const requiredFile of pkg.require) {
      const installedPath = path.join(
        packageInstallDir,
        "node_modules",
        pkg.packageName,
        requiredFile,
      );
      if (!existsSync(installedPath)) {
        throw new Error(
          `Installed package missing required file: ${pkg.packageName}/${requiredFile}`,
        );
      }
    }

    for (const forbiddenFragment of pkg.forbid) {
      const forbiddenPath = path.join(
        packageInstallDir,
        "node_modules",
        pkg.packageName,
        forbiddenFragment,
      );
      if (existsSync(forbiddenPath)) {
        throw new Error(
          `Installed package contains forbidden artifact: ${pkg.packageName}/${forbiddenFragment}`,
        );
      }
    }
  }

  console.log("Smoke-installed packaged Plug workspaces successfully.");
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
