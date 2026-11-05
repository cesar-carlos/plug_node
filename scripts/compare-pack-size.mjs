import { readFileSync } from "node:fs";
import { readNpmPackOutput } from "./npm-pack-output.mjs";

const [base, candidate] = process.argv
  .slice(2)
  .map((file) =>
    readNpmPackOutput(readFileSync(file, "utf8"), "n8n-nodes-plug-database"),
  );
console.log("| Metric (bytes) | Base | PR merge | Difference |");
console.log("|---|---:|---:|---:|");
for (const metric of ["size", "unpackedSize"]) {
  const delta = candidate[metric] - base[metric];
  console.log(
    `| ${metric} | ${base[metric]} | ${candidate[metric]} | ${delta > 0 ? "+" : ""}${delta} |`,
  );
}
