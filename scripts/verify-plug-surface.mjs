import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import {
  bannedIdentifiers,
  bannedPathFragments,
  plugPackageSurface,
  removedSourceDirectories,
  removedSourcePaths,
  rootsToScan,
} from "./package-surface.config.mjs";

const rootDir = process.cwd();

const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(rootDir, relativePath), "utf8"));

const assertEqualJson = (actual, expected, label) => {
  const actualText = JSON.stringify(actual);
  const expectedText = JSON.stringify(expected);
  if (actualText !== expectedText) {
    throw new Error(
      `${label} mismatch.\nExpected: ${expectedText}\nReceived: ${actualText}`,
    );
  }
};

for (const pkg of plugPackageSurface) {
  const manifest = readJson(`packages/${pkg.workspace}/package.json`);
  assertEqualJson(
    manifest.n8n.credentials,
    pkg.manifest.credentials,
    `${pkg.workspace} credentials`,
  );
  assertEqualJson(manifest.n8n.nodes, pkg.manifest.nodes, `${pkg.workspace} nodes`);
}

for (const relativePath of removedSourcePaths) {
  if (existsSync(path.join(rootDir, relativePath))) {
    throw new Error(`Legacy Plug artifact still exists: ${relativePath}`);
  }
}

for (const relativePath of removedSourceDirectories) {
  if (existsSync(path.join(rootDir, relativePath))) {
    throw new Error(`Legacy Plug directory still exists: ${relativePath}`);
  }
}

const allowedFileExtensions = new Set([".ts", ".md", ".json", ".yml", ".yaml"]);
const ignoredDirectories = new Set([
  ".git",
  ".changeset",
  "node_modules",
  "dist",
  "generated",
]);
const ignoredFiles = new Set(["package-lock.json"]);

const scanFile = (absolutePath) => {
  const relativePath = path.relative(rootDir, absolutePath).replaceAll("\\", "/");
  if (relativePath.endsWith("CHANGELOG.md")) {
    return;
  }

  const contents = readFileSync(absolutePath, "utf8");
  for (const identifier of bannedIdentifiers) {
    if (contents.includes(identifier)) {
      throw new Error(`Legacy identifier "${identifier}" found in ${relativePath}`);
    }
  }

  for (const fragment of bannedPathFragments) {
    if (contents.includes(fragment)) {
      throw new Error(`Legacy path fragment "${fragment}" found in ${relativePath}`);
    }
  }
};

const walk = (absolutePath) => {
  const stats = statSync(absolutePath);
  if (stats.isDirectory()) {
    for (const entry of readdirSync(absolutePath)) {
      if (ignoredDirectories.has(entry)) {
        continue;
      }

      walk(path.join(absolutePath, entry));
    }
    return;
  }

  const extension = path.extname(absolutePath).toLowerCase();
  const fileName = path.basename(absolutePath);
  if (!allowedFileExtensions.has(extension) || ignoredFiles.has(fileName)) {
    return;
  }

  scanFile(absolutePath);
};

for (const root of rootsToScan) {
  walk(path.join(rootDir, root));
}

console.log("Verified Plug credential and node surface.");
