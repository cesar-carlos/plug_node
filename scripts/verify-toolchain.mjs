import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const root = process.cwd();
const manifests = ["package.json", "packages/n8n-nodes-plug-database/package.json"];
for (const file of manifests) {
  const absolute = path.join(root, file);
  const manifest = JSON.parse(readFileSync(absolute, "utf8"));
  const require = createRequire(absolute);
  assert.equal(manifest.devDependencies.typescript, "npm:@typescript/typescript6@6.0.2");
  assert.equal(manifest.devDependencies["@typescript/native"], "npm:typescript@7.0.2");
  assert.equal(require("typescript").version, "6.0.2", `${file}: compiler API`);
  const nativeManifest = require.resolve("@typescript/native/package.json");
  const native = JSON.parse(readFileSync(nativeManifest, "utf8"));
  assert.equal(native.version, "7.0.2");
  const executable = path.resolve(path.dirname(nativeManifest), native.bin.tsc);
  const output = execFileSync(process.execPath, [executable, "--version"], {
    encoding: "utf8",
  }).trim();
  assert.match(output, /\b7\.0\.2\b/u, `${file}: native executable`);
}

const rootManifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
assert.equal(rootManifest.packageManager, "npm@12.2.0");
assert.equal(
  rootManifest.devDependencies.ignore,
  "5.3.2",
  "Legacy CLI optional peer bridge",
);
const rootRequire = createRequire(path.join(root, "package.json"));
assert.equal(rootRequire("ignore/package.json").version, "5.3.2");
const cruiserRequire = createRequire(import.meta.resolve("dependency-cruiser"));
assert.match(
  cruiserRequire("ignore/package.json").version,
  /^7\./u,
  "Do not downgrade dependency-cruiser's parser",
);
assert.equal(process.version, "v24.18.0");
if (process.env.npm_execpath) {
  const version = execFileSync(
    process.execPath,
    [process.env.npm_execpath, "--version"],
    {
      encoding: "utf8",
    },
  ).trim();
  assert.equal(version, "12.2.0", "Run with the workspace's pinned npm version");
  const tsc = execFileSync(
    process.execPath,
    [
      process.env.npm_execpath,
      "exec",
      "--offline",
      "--workspace",
      "n8n-nodes-plug-database",
      "--",
      "tsc",
      "--version",
    ],
    { encoding: "utf8" },
  );
  assert.match(tsc, /\b7\.0\.2\b/u, "The n8n CLI must resolve the native tsc");
}
console.log(
  "Verified Node 24.18.0, npm 12.2.0, TypeScript 7 compiler and TypeScript 6 API.",
);
