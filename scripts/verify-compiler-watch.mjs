import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = process.cwd();
const require = createRequire(path.join(root, "package.json"));
const nativeRoot = path.dirname(require.resolve("@typescript/native/package.json"));
const { default: getExePath } = await import(
  pathToFileURL(path.join(nativeRoot, "lib/getExePath.js"))
);
const scratch = path.join(root, "tmp");
mkdirSync(scratch, { recursive: true });
const directory = mkdtempSync(path.join(scratch, "compiler-watch-"));
const source = path.join(directory, "main.ts");
writeFileSync(
  path.join(directory, "tsconfig.json"),
  JSON.stringify({
    extends: path.join(root, "packages/n8n-nodes-plug-database/tsconfig.json"),
    compilerOptions: {
      rootDir: ".",
      outDir: "./dist",
      tsBuildInfoFile: "./state.tsbuildinfo",
    },
    include: ["main.ts"],
  }),
);
writeFileSync(source, "export const value: number = 1;\n");
const child = spawn(
  getExePath(),
  ["--project", path.join(directory, "tsconfig.json"), "--watch", "--pretty", "false"],
  { stdio: ["ignore", "pipe", "pipe"] },
);
const waitFor = (pattern, change = () => undefined) =>
  new Promise((resolve, reject) => {
    let text = "";
    const cleanup = () => {
      clearTimeout(timer);
      child.stdout.off("data", onData);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
      child.off("error", onError);
    };
    const onData = (data) => {
      text += data.toString();
      if (pattern.test(text)) {
        cleanup();
        resolve();
      }
    };
    const onExit = (code) => {
      cleanup();
      reject(new Error(`Watch exited ${code}: ${text}`));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error(`Watch timeout waiting for ${pattern}: ${text}`));
    }, 30_000);
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", onExit);
    child.on("error", onError);
    change();
  });
try {
  await waitFor(/Found 0 errors/u);
  await waitFor(/Found 1 error/u, () =>
    writeFileSync(source, 'export const value: number = "invalid";\n'),
  );
  await waitFor(/Found 0 errors/u, () =>
    writeFileSync(source, "export const value: number = 2;\n"),
  );
  await waitFor(/TS(?:18003|6053)/u, () => rmSync(source));
  await waitFor(/Found 0 errors/u, () =>
    writeFileSync(source, "export const value: number = 3;\n"),
  );
  assert.equal(child.exitCode, null);
  console.log(
    "Verified native compiler watch: initial build, error, repair, deletion and recreation.",
  );
} finally {
  if (child.pid !== undefined && child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolve) => child.once("exit", resolve));
    child.kill();
    await exited;
  }
  if (!directory.startsWith(scratch + path.sep))
    throw new Error("Invalid watch scratch directory");
  rmSync(directory, { recursive: true, force: true });
}
