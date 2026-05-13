import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const oldPackageName = "n8n-nodes-plug-database-advanced";
const newPackageName = "n8n-nodes-plug-database";

const accountCredentialKey = "plugDatabaseAccountApi";

/** @type {ReadonlySet<string>} */
const legacyCredentialKeys = new Set([
  "plugDatabaseAdvancedApi",
  "plugDatabaseApi",
  "plugDatabaseClientApi",
  "plugDatabaseUserApi",
]);

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

/**
 * @param {Record<string, unknown>} credentials
 * @param {Array<Record<string, unknown>>} changes
 * @param {string} location
 * @param {string | undefined} nodeName
 */
const migrateCredentialKeys = (credentials, changes, location, nodeName) => {
  if (!isRecord(credentials)) {
    return;
  }

  for (const oldKey of legacyCredentialKeys) {
    if (!Object.prototype.hasOwnProperty.call(credentials, oldKey)) {
      continue;
    }

    const value = credentials[oldKey];
    delete credentials[oldKey];

    const accountPresent = Object.prototype.hasOwnProperty.call(
      credentials,
      accountCredentialKey,
    );

    if (accountPresent) {
      changes.push({
        kind: "credentialKeyDropped",
        location: `${location}.${oldKey}`,
        name: nodeName,
        oldKey,
        newKey: accountCredentialKey,
        detail: "plugDatabaseAccountApi already present; removed legacy alias entry",
      });
      continue;
    }

    credentials[accountCredentialKey] = value;
    changes.push({
      kind: "credentialKey",
      location: `${location}.${oldKey}`,
      name: nodeName,
      oldKey,
      newKey: accountCredentialKey,
    });
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

  const nodeName = typeof value.name === "string" ? value.name : undefined;

  if (typeof value.type === "string" && isRecord(value.credentials)) {
    migrateCredentialKeys(
      value.credentials,
      changes,
      `${location}.credentials`,
      nodeName,
    );
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
        kind: "nodeType",
        location,
        name: nodeName,
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

const parseCliArgs = (argv) => {
  const write = argv.includes("--write");
  const check = argv.includes("--check");
  const backup = argv.includes("--backup");
  let outputDir = null;
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--write" || token === "--check" || token === "--backup") {
      continue;
    }
    if (token === "--output-dir") {
      const next = argv[i + 1];
      if (typeof next !== "string" || next.startsWith("--")) {
        throw new Error("--output-dir requires a directory path");
      }
      outputDir = path.resolve(next);
      i += 1;
      continue;
    }
    positional.push(token);
  }

  return { write, check, backup, outputDir, targets: positional };
};

const usage = () => {
  console.error(`Usage: node scripts/migrate-advanced-workflows.mjs [options] <workflow.json|directory> [...]

Options:
  --write              Apply migrations to JSON files (default: dry run)
  --check              Exit with code 1 when any migration would be applied (CI gate)
  --backup             With --write and in-place output, copy each original to <file>.bak first
  --output-dir <dir>   With --write, write migrated JSON under <dir> preserving paths relative to cwd
                       (original files are not modified)
`);
};

const describeChange = (change) => {
  const label = change.name ? ` (${change.name})` : "";
  if (change.kind === "nodeType") {
    return `  - ${change.location}${label}: ${change.oldType} -> ${change.newType}`;
  }
  if (change.kind === "credentialKey") {
    return `  - ${change.location}${label}: credential ${change.oldKey} -> ${change.newKey}`;
  }
  if (change.kind === "credentialKeyDropped") {
    return `  - ${change.location}${label}: dropped legacy credential key ${change.oldKey} (${change.detail})`;
  }
  return `  - ${change.location}${label}: ${JSON.stringify(change)}`;
};

const runCli = () => {
  let parsed;
  try {
    parsed = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    usage();
    process.exitCode = 2;
    return;
  }

  const { write, check, backup, outputDir, targets } = parsed;

  if (targets.length === 0) {
    usage();
    process.exitCode = 2;
    return;
  }

  if (outputDir && !write) {
    console.error("--output-dir is only used together with --write.");
    process.exitCode = 2;
    return;
  }

  const cwd = process.cwd();
  let totalChanges = 0;

  for (const target of targets) {
    const files = collectJsonFiles(target);
    for (const file of files) {
      const original = readFileSync(file, "utf8");
      const parsedJson = JSON.parse(original);
      const { document, changes } = migrateWorkflowDocument(parsedJson);
      if (changes.length === 0) {
        continue;
      }

      totalChanges += changes.length;
      console.log(`\n${file}`);
      for (const change of changes) {
        console.log(describeChange(change));
      }

      if (write) {
        const payload = `${JSON.stringify(document, null, 2)}\n`;
        if (outputDir) {
          const relativeFromCwd = path.relative(cwd, file);
          const safeRelative =
            relativeFromCwd &&
            !relativeFromCwd.startsWith("..") &&
            !path.isAbsolute(relativeFromCwd)
              ? relativeFromCwd
              : path.basename(file);
          const outPath = path.join(outputDir, safeRelative);
          mkdirSync(path.dirname(outPath), { recursive: true });
          writeFileSync(outPath, payload);
        } else {
          if (backup) {
            copyFileSync(file, `${file}.bak`);
          }
          writeFileSync(file, payload);
        }
      }
    }
  }

  if (totalChanges === 0) {
    console.log("No legacy Plug workflow migrations needed.");
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
