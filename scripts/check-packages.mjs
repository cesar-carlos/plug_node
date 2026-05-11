import { spawnSync } from "node:child_process";

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const packages = [
  {
    workspace: "n8n-nodes-plug-database",
    maxPackedSizeBytes: 200_000,
    maxUnpackedSizeBytes: 1_200_000,
    forbid: [
      "dist/tsconfig.tsbuildinfo",
      "dist/generated/shared/socket/",
      "dist/generated/shared/contracts/payload-frame.",
    ],
  },
  {
    workspace: "n8n-nodes-plug-database-advanced",
    maxPackedSizeBytes: 250_000,
    maxUnpackedSizeBytes: 1_600_000,
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

  if (packResult.size > pkg.maxPackedSizeBytes) {
    throw new Error(
      `Tarball for ${pkg.workspace} is ${packResult.size} bytes, above limit ${pkg.maxPackedSizeBytes}`,
    );
  }

  if (packResult.unpackedSize > pkg.maxUnpackedSizeBytes) {
    throw new Error(
      `Unpacked tarball for ${pkg.workspace} is ${packResult.unpackedSize} bytes, above limit ${pkg.maxUnpackedSizeBytes}`,
    );
  }

  console.log(
    `Validated npm pack output for ${pkg.workspace} (${packResult.size} packed bytes, ${packResult.unpackedSize} unpacked bytes)`,
  );
}
