import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const directory = path.resolve(process.argv[2]);
const require = createRequire(path.join(directory, "package.json"));
const packageRoot = path.join(directory, "node_modules/n8n-nodes-plug-database");
const manifest = JSON.parse(readFileSync(path.join(packageRoot, "package.json"), "utf8"));
for (const file of [...manifest.n8n.nodes, ...manifest.n8n.credentials]) {
  const exports = require(path.join(packageRoot, file));
  const constructors = Object.values(exports).filter(
    (value) => typeof value === "function",
  );
  assert.equal(constructors.length, 1, `${file}: exported class`);
  const instance = new constructors[0]();
  assert.ok(instance.name || instance.description?.name, `${file}: n8n metadata`);
}
assert.equal(manifest.n8n.nodes.length, 5);
assert.equal(manifest.n8n.credentials.length, 6);
assert.equal(manifest.dependencies.zod4, "npm:zod@4.6.5");
assert.equal(manifest.dependencies.zod, "3.25.76");
for (const name of ["@n8n/node-cli", "@typescript/native", "vitest"]) {
  assert.throws(() => require.resolve(name), { code: "MODULE_NOT_FOUND" });
}

if (process.argv.includes("--native")) {
  const sharp = require("sharp");
  const image = await sharp({
    create: { width: 32, height: 32, channels: 3, background: "white" },
  })
    .resize(16, 16)
    .png()
    .toBuffer();
  assert.equal((await sharp(image).metadata()).width, 16);
  const pdfTools = require(path.join(packageRoot, "dist/generated/shared/tools/pdf.js"));
  const documents = require(
    path.join(packageRoot, "dist/generated/shared/tools/documents.js"),
  );
  const renderer = pdfTools.createPlaywrightHtmlToPdfRenderer();
  try {
    const buffer = await renderer.render({
      html: "<!doctype html><html><body>Plug runtime smoke</body></html>",
      browser: pdfTools.resolvePdfBrowserLaunchOptions({
        channel: "auto",
        timeoutMs: 30_000,
      }),
      pdf: pdfTools.resolvePdfRenderOptions({}),
    });
    assert.equal(buffer.subarray(0, 4).toString(), "%PDF");
    assert.match((await documents.extractPdfText(buffer)).text, /Plug runtime smoke/u);
  } finally {
    await renderer.close();
  }
}
console.log(
  `Loaded five nodes and six credentials${process.argv.includes("--native") ? "; sharp, Chromium and PDF extraction passed" : ""}.`,
);
