import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const oldPackageName = "n8n-nodes-plug-database-advanced";
const newPackageName = "n8n-nodes-plug-database";

const typeMigrations = [
  {
    oldName: "plugDatabaseAdvanced",
    newName: "plugDatabase",
  },
  {
    oldName: "plugDatabaseAdvancedSocketEventTrigger",
    newName: "plugDatabaseSocketEventTrigger",
  },
  {
    oldName: "plugDatabaseAdvancedPdf",
    newName: "plugDatabase",
    parameters: {
      resource: "tools",
      toolCategory: "documents",
      operation: "htmlToPdf",
    },
  },
  {
    oldName: "plugDatabaseAdvancedBarcode",
    newName: "plugDatabase",
    parameters: {
      resource: "tools",
      toolCategory: "identity",
      operation: "generateCode",
    },
  },
];

const replaceNodeType = (nodeType) => {
  for (const migration of typeMigrations) {
    if (nodeType === migration.oldName) {
      return {
        migration,
        migratedType: migration.newName,
      };
    }

    const suffix = `.${migration.oldName}`;
    if (nodeType.endsWith(suffix)) {
      const prefix = nodeType.slice(0, -suffix.length);
      const migratedPrefix = prefix === oldPackageName ? newPackageName : prefix;
      return {
        migration,
        migratedType: `${migratedPrefix}.${migration.newName}`,
      };
    }
  }

  return undefined;
};

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const applyDefaultParameters = (node, parameters) => {
  if (!isRecord(node.parameters)) {
    node.parameters = {};
  }

  for (const [name, value] of Object.entries(parameters)) {
    if (node.parameters[name] === undefined || name === "resource") {
      node.parameters[name] = value;
    }
  }
};

const visitWorkflowValue = (value, changes, location) => {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      visitWorkflowValue(value[index], changes, `${location}[${index}]`);
    }
    return;
  }

  if (!isRecord(value)) {
    return;
  }

  if (typeof value.type === "string") {
    const replacement = replaceNodeType(value.type);
    if (replacement) {
      const oldType = value.type;
      value.type = replacement.migratedType;
      if (replacement.migration.parameters) {
        applyDefaultParameters(value, replacement.migration.parameters);
      }

      changes.push({
        location,
        name: typeof value.name === "string" ? value.name : undefined,
        oldType,
        newType: replacement.migratedType,
      });
    }
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "parameters") {
      continue;
    }
    visitWorkflowValue(child, changes, `${location}.${key}`);
  }
};

export const migrateWorkflowDocument = (document) => {
  const changes = [];
  visitWorkflowValue(document, changes, "$");
  return {
    document,
    changes,
  };
};

const collectJsonFiles = (targetPath) => {
  const absolutePath = path.resolve(targetPath);
  if (!existsSync(absolutePath)) {
    throw new Error(`Path does not exist: ${absolutePath}`);
  }

  const stats = statSync(absolutePath);
  if (stats.isFile()) {
    return absolutePath.endsWith(".json") ? [absolutePath] : [];
  }

  const files = [];
  for (const entry of readdirSync(absolutePath)) {
    if (entry === "node_modules" || entry === "dist") {
      continue;
    }
    files.push(...collectJsonFiles(path.join(absolutePath, entry)));
  }
  return files;
};

const usage = () => {
  console.error(
    "Usage: node scripts/migrate-advanced-workflows.mjs [--write] [--check] <workflow.json|directory> [...]",
  );
};

const runCli = () => {
  const args = process.argv.slice(2);
  const write = args.includes("--write");
  const check = args.includes("--check");
  const targets = args.filter((arg) => arg !== "--write" && arg !== "--check");

  if (targets.length === 0) {
    usage();
    process.exitCode = 2;
    return;
  }

  let totalChanges = 0;
  for (const target of targets) {
    const files = collectJsonFiles(target);
    for (const file of files) {
      const original = readFileSync(file, "utf8");
      const parsed = JSON.parse(original);
      const { document, changes } = migrateWorkflowDocument(parsed);
      if (changes.length === 0) {
        continue;
      }

      totalChanges += changes.length;
      console.log(`\n${file}`);
      for (const change of changes) {
        const label = change.name ? ` (${change.name})` : "";
        console.log(
          `  - ${change.location}${label}: ${change.oldType} -> ${change.newType}`,
        );
      }

      if (write) {
        writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`);
      }
    }
  }

  if (totalChanges === 0) {
    console.log("No legacy Plug Database Advanced workflow nodes found.");
    return;
  }

  if (!write) {
    console.log("\nDry run only. Re-run with --write to update files.");
  }

  if (check) {
    process.exitCode = 1;
  }
};

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCli();
}
