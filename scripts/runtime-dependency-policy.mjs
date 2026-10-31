// Self-hosted runtime libraries exercised by the package and native smoke suites.
export const allowedRuntimeDependencies = new Set([
  "@bwip-js/node",
  "@playwright/browser-chromium",
  "@zxing/library",
  "ajv",
  "ajv-formats",
  "jose",
  "jsonata",
  "marked",
  "papaparse",
  "pdf-lib",
  "pdfjs-dist",
  "playwright-core",
  "sharp",
  "socket.io-client",
  "to-words",
  "zod",
  "zod4",
]);

export const validateRuntimeDependencies = (dependencies) => {
  for (const [name, version] of Object.entries(dependencies ?? {})) {
    if (!allowedRuntimeDependencies.has(name))
      throw new Error(`Unreviewed runtime dependency: ${name}`);
    if (
      name === "zod4" &&
      (typeof version !== "string" || !version.startsWith("npm:zod@"))
    ) {
      throw new Error("zod4 must remain an npm alias of zod.");
    }
    const pin =
      name === "zod4" && typeof version === "string"
        ? version.replace(/^npm:zod@/, "")
        : version;
    if (typeof pin !== "string" || !/^\d+\.\d+\.\d+$/.test(pin))
      throw new Error(`Runtime dependency must use an exact stable version: ${name}`);
  }
};
