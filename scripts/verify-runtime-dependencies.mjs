import { readFileSync } from "node:fs";
import { validateRuntimeDependencies } from "./runtime-dependency-policy.mjs";

const manifest = JSON.parse(
  readFileSync(
    new URL("../packages/n8n-nodes-plug-database/package.json", import.meta.url),
    "utf8",
  ),
);
validateRuntimeDependencies(manifest.dependencies);
console.log("Verified reviewed, exactly pinned self-hosted runtime dependencies.");
