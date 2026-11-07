import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { readNpmPackOutput } from "./npm-pack-output.mjs";

// Disposable n8n + synthetic TLS Hub. Never loads .env or local agent credentials.
const image = process.env.PLUG_N8N_TEST_IMAGE ?? "n8nio/n8n:2.45.7";
const container = `plug-credential-n8n-${randomUUID().slice(0, 8)}`;
const root = resolve("tmp/credential-source-n8n");
mkdirSync(root, { recursive: true });
const scratch = mkdtempSync(join(root, "run-"));
const run = (command, args) =>
  execFileSync(command, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 300000,
    maxBuffer: 16 * 1024 * 1024,
  });
const npm = (args) => {
  const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", args, {
    encoding: "utf8",
    windowsHide: true,
    shell: process.platform === "win32",
    timeout: 300000,
  });
  if (result.status !== 0) throw new Error(result.stderr || "npm failed");
  return result.stdout;
};
let created = false;
try {
  npm(["run", "build"]);
  const pack = readNpmPackOutput(
    npm([
      "pack",
      "--json",
      "--workspace",
      "n8n-nodes-plug-database",
      "--pack-destination",
      scratch,
    ]),
    "n8n-nodes-plug-database",
  );
  const openssl =
    process.env.PLUG_FIXTURE_OPENSSL ??
    (process.platform === "win32"
      ? "C:/Program Files/Git/usr/bin/openssl.exe"
      : "openssl");
  run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    join(scratch, "fixture.key"),
    "-out",
    join(scratch, "fixture.crt"),
    "-days",
    "1",
    "-subj",
    "/CN=plug-server.se7esistemassinop.com.br",
    "-addext",
    "subjectAltName=DNS:plug-server.se7esistemassinop.com.br",
  ]);
  run("docker", [
    "run",
    "-d",
    "--name",
    container,
    "--add-host",
    "plug-server.se7esistemassinop.com.br:127.0.0.1",
    "--entrypoint",
    "sleep",
    "-e",
    "N8N_DIAGNOSTICS_ENABLED=false",
    "-e",
    "N8N_VERSION_NOTIFICATIONS_ENABLED=false",
    "-e",
    "N8N_TEMPLATES_ENABLED=false",
    image,
    "infinity",
  ]);
  created = true;
  for (const name of ["fixture.key", "fixture.crt"])
    run("docker", ["cp", join(scratch, name), `${container}:/tmp/${name}`]);
  run("docker", ["cp", join(scratch, pack.filename), `${container}:/tmp/plug.tgz`]);
  run("docker", [
    "exec",
    container,
    "sh",
    "-c",
    "mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --ignore-scripts --omit=dev /tmp/plug.tgz",
  ]);
  run("docker", ["network", "disconnect", "bridge", container]);
  run("docker", [
    "cp",
    resolve("scripts/fixtures/credential-source-n8n.cjs"),
    `${container}:/tmp/credential-source-n8n.cjs`,
  ]);
  for (const file of [
    "action-account-echo-workflow.json",
    "action-complete-output-workflow.json",
    "sql-extensions-account-workflow.json",
  ])
    run("docker", [
      "cp",
      resolve("docs/socket/examples", file),
      container + ":/tmp/" + file,
    ]);
  const output = run("docker", [
    "exec",
    "-e",
    "NODE_EXTRA_CA_CERTS=/tmp/fixture.crt",
    "-e",
    "N8N_DEFAULT_BINARY_DATA_MODE=filesystem",
    container,
    "node",
    "/tmp/credential-source-n8n.cjs",
  ]);
  const report = {
    ...JSON.parse(output.trim()),
    image,
    tarball: { shasum: pack.shasum, size: pack.size },
    testedAt: new Date().toISOString(),
  };
  writeFileSync(join(root, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  if (created) run("docker", ["rm", "-f", container]);
  // mkdtempSync created this exact task-owned path under the workspace scratch directory.
  rmSync(scratch, { recursive: true, force: true });
}
