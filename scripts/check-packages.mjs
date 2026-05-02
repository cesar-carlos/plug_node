import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const packages = [
  {
    workspace: "n8n-nodes-plug-database",
    forbid: [
      "dist/tsconfig.tsbuildinfo",
      "dist/generated/shared/socket/",
      "dist/generated/shared/contracts/payload-frame.",
    ],
  },
  {
    workspace: "n8n-nodes-plug-database-advanced",
    forbid: ["dist/tsconfig.tsbuildinfo"],
  },
];

const runPackDryRun = (workspace) => {
  const result = spawnSync(
    npmCommand,
    ["pack", "--json", "--dry-run", "--workspace", workspace],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    },
  );

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const stderr = typeof result.stderr === "string" ? result.stderr.trim() : "";
    throw new Error(stderr === "" ? `npm pack failed for ${workspace}` : stderr);
  }

  const stdout = typeof result.stdout === "string" ? result.stdout.trim() : "";
  const parsed = JSON.parse(stdout);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error(`Unexpected npm pack output for ${workspace}`);
  }

  return parsed[0];
};

for (const pkg of packages) {
  const packResult = runPackDryRun(pkg.workspace);
  const files = Array.isArray(packResult.files)
    ? packResult.files.map((file) => String(file.path))
    : [];

  if (!files.some((file) => file === "README.md")) {
    throw new Error(`README.md is missing from ${pkg.workspace} tarball`);
  }

  for (const forbiddenFragment of pkg.forbid) {
    if (files.some((file) => file.includes(forbiddenFragment))) {
      throw new Error(
        `Tarball for ${pkg.workspace} contains forbidden artifact: ${forbiddenFragment}`,
      );
    }
  }

  console.log(`Validated npm pack output for ${pkg.workspace}`);
}
