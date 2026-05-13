import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { plugPackageSurface } from "./package-surface.config.mjs";

const require = createRequire(import.meta.url);
const rootDir = process.cwd();
const checkMode = process.argv.includes("--check");

const readJson = (relativePath) =>
  JSON.parse(readFileSync(path.join(rootDir, relativePath), "utf8"));

const sameJson = (actual, expected) =>
  JSON.stringify(actual) === JSON.stringify(expected);

const assertEqualJson = (actual, expected, label) => {
  if (!sameJson(actual, expected)) {
    throw new Error(
      `${label} mismatch.\nExpected: ${JSON.stringify(expected)}\nReceived: ${JSON.stringify(actual)}`,
    );
  }
};

const credentialClassNameFromFile = (credentialFile) =>
  credentialFile.replace(/\.credentials\.js$/, "");

const loadBuiltCredential = (pkg, credentialPath) => {
  const absolutePath = path.join(rootDir, "packages", pkg.workspace, credentialPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Built credential file is missing: ${absolutePath}`);
  }

  const className = credentialClassNameFromFile(path.basename(credentialPath));
  const credentialModule = require(absolutePath);
  const CredentialClass = credentialModule[className];
  if (typeof CredentialClass !== "function") {
    throw new Error(`${credentialPath} does not export ${className}`);
  }

  return new CredentialClass();
};

const verifyBuiltCredentialAliases = (pkg) => {
  const accountCredential = loadBuiltCredential(
    pkg,
    "dist/credentials/PlugDatabaseAccountApi.credentials.js",
  );

  for (const alias of pkg.legacyCredentialAliases ?? []) {
    const credential = loadBuiltCredential(
      pkg,
      `dist/credentials/${alias.credentialFile}`,
    );

    assertEqualJson(
      credential.extends,
      ["plugDatabaseAccountApi"],
      `${pkg.workspace} ${alias.name} extends`,
    );
    assertEqualJson(
      credential.properties,
      [],
      `${pkg.workspace} ${alias.name} properties`,
    );

    if (credential.name !== alias.name) {
      throw new Error(
        `${pkg.workspace} ${alias.credentialFile} name mismatch. Expected ${alias.name}, received ${credential.name}`,
      );
    }

    if (credential.test !== accountCredential.test) {
      throw new Error(
        `${pkg.workspace} ${alias.name} does not reuse the shared Plug account credential test`,
      );
    }

    assertEqualJson(
      credential.test?.request?.body,
      {
        email: "={{$credentials.user}}",
        password: "={{$credentials.password}}",
      },
      `${pkg.workspace} ${alias.name} login test body`,
    );
  }
};

const summarizePackage = (pkg) => {
  const sourceManifest = readJson(`packages/${pkg.workspace}/package.json`);
  const distManifestPath = `packages/${pkg.workspace}/dist/package.json`;
  const hasDistManifest = existsSync(path.join(rootDir, distManifestPath));
  const distManifest = hasDistManifest ? readJson(distManifestPath) : undefined;
  const sourceAligned =
    sameJson(sourceManifest.n8n.credentials, pkg.manifest.credentials) &&
    sameJson(sourceManifest.n8n.nodes, pkg.manifest.nodes);
  const distAligned =
    distManifest !== undefined &&
    sameJson(distManifest.n8n.credentials, pkg.manifest.credentials) &&
    sameJson(distManifest.n8n.nodes, pkg.manifest.nodes);

  console.log(`\n${pkg.packageName}`);
  console.log(`  source package.json aligned: ${sourceAligned ? "yes" : "no"}`);
  console.log(
    `  dist/package.json aligned: ${
      hasDistManifest ? (distAligned ? "yes" : "no") : "missing"
    }`,
  );
  console.log("  registered credentials:");
  for (const credential of pkg.manifest.credentials) {
    console.log(`    - ${credential}`);
  }
  console.log("  registered nodes:");
  for (const node of pkg.manifest.nodes) {
    console.log(`    - ${node}`);
  }
  console.log("  legacy credential aliases:");
  for (const alias of pkg.legacyCredentialAliases ?? []) {
    console.log(`    - ${alias.name} -> plugDatabaseAccountApi`);
  }

  if (!checkMode) {
    return;
  }

  assertEqualJson(
    sourceManifest.n8n.credentials,
    pkg.manifest.credentials,
    `${pkg.workspace} source credentials`,
  );
  assertEqualJson(
    sourceManifest.n8n.nodes,
    pkg.manifest.nodes,
    `${pkg.workspace} source nodes`,
  );
  if (distManifest === undefined) {
    throw new Error(`${distManifestPath} is missing. Run npm run build first.`);
  }
  assertEqualJson(
    distManifest.n8n.credentials,
    pkg.manifest.credentials,
    `${pkg.workspace} dist credentials`,
  );
  assertEqualJson(
    distManifest.n8n.nodes,
    pkg.manifest.nodes,
    `${pkg.workspace} dist nodes`,
  );
  verifyBuiltCredentialAliases(pkg);
};

console.log("Plug package surface diagnostic");

for (const pkg of plugPackageSurface) {
  summarizePackage(pkg);
}

if (checkMode) {
  console.log("\nVerified built Plug package surface.");
}
