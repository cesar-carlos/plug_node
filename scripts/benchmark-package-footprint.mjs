import { spawnSync } from "node:child_process";
import { readdirSync, statSync, readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(
  new URL("../packages/n8n-nodes-plug-database/package.json", import.meta.url),
);
const packages = [
  "sharp",
  "pdfjs-dist",
  "pdf-lib",
  "playwright-core",
  "@playwright/browser-chromium",
  "@bwip-js/node",
  "@zxing/library",
];
const directoryBytes = (directory) =>
  readdirSync(directory, { withFileTypes: true }).reduce((total, entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) return total;
    return total + (entry.isDirectory() ? directoryBytes(target) : statSync(target).size);
  }, 0);

if (process.argv[2] === "--worker") {
  const name = process.argv[3];
  if (!packages.includes(name)) throw new Error("Unknown footprint target");
  const rss = process.memoryUsage().rss;
  const started = performance.now();
  require(name);
  console.log(
    JSON.stringify({
      importMs: performance.now() - started,
      rssDeltaBytes: process.memoryUsage().rss - rss,
    }),
  );
} else {
  const report = [];
  for (const name of packages) {
    let directory = path.dirname(require.resolve(name));
    while (
      !existsSync(path.join(directory, "package.json")) ||
      JSON.parse(readFileSync(path.join(directory, "package.json"), "utf8")).name !== name
    ) {
      const parent = path.dirname(directory);
      if (parent === directory) throw new Error(`Cannot locate ${name}`);
      directory = parent;
    }
    const result = spawnSync(
      process.execPath,
      [fileURLToPath(import.meta.url), "--worker", name],
      { encoding: "utf8", timeout: 30_000 },
    );
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
    const measurement = JSON.parse(result.stdout.trim().split("\n").at(-1));
    report.push({
      package: name,
      installedBytes: directoryBytes(directory),
      ...measurement,
    });
  }
  const chromium = require("playwright-core").chromium.executablePath();
  console.log(
    JSON.stringify(
      {
        node: process.version,
        platform: process.platform,
        packages: report,
        chromium: {
          available: existsSync(chromium),
          installedBytes: existsSync(chromium)
            ? directoryBytes(path.dirname(chromium))
            : null,
        },
        note: "Single isolated import per package; package sizes exclude hoisted transitive dependencies. RSS and import timing vary by host and cache.",
      },
      null,
      2,
    ),
  );
}
