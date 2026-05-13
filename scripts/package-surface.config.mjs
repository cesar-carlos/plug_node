export const allowedLegacyCredentialAliases = [
  {
    name: "plugDatabaseApi",
    credentialFile: "PlugDatabaseApi.credentials.js",
  },
  {
    name: "plugDatabaseAdvancedApi",
    credentialFile: "PlugDatabaseAdvancedApi.credentials.js",
  },
  {
    name: "plugDatabaseClientApi",
    credentialFile: "PlugDatabaseClientApi.credentials.js",
  },
  {
    name: "plugDatabaseUserApi",
    credentialFile: "PlugDatabaseUserApi.credentials.js",
  },
];

export const allowedLegacyCredentialAliasPaths = allowedLegacyCredentialAliases.map(
  (alias) => `dist/credentials/${alias.credentialFile}`,
);

export const plugPackageSurface = [
  {
    workspace: "n8n-nodes-plug-database",
    packageName: "n8n-nodes-plug-database",
    maxPackedSizeBytes: 300_000,
    maxUnpackedSizeBytes: 1_900_000,
    manifest: {
      credentials: [
        "dist/credentials/PlugDatabaseAccountApi.credentials.js",
        ...allowedLegacyCredentialAliasPaths,
        "dist/credentials/PluraAiAutomationsApi.credentials.js",
      ],
      nodes: [
        "dist/nodes/PlugDatabase/PlugDatabase.node.js",
        "dist/nodes/PlugDatabaseSocketEventTrigger/PlugDatabaseSocketEventTrigger.node.js",
        "dist/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node.js",
      ],
    },
    require: [
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
      ...allowedLegacyCredentialAliasPaths,
      "dist/credentials/PluraAiAutomationsApi.credentials.js",
      "dist/nodes/PlugDatabase/PlugDatabase.node.js",
      "dist/nodes/PlugDatabase/socketCommandExecutor.js",
      "dist/nodes/PlugDatabaseSocketEventTrigger/PlugDatabaseSocketEventTrigger.node.js",
      "dist/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node.js",
    ],
    forbid: [
      "dist/tsconfig.tsbuildinfo",
      "dist/nodes/PlugDatabaseAdvanced/",
      "dist/nodes/PlugDatabaseAdvancedPdf/",
      "dist/nodes/PlugDatabaseAdvancedBarcode/",
      "dist/nodes/PlugDatabaseAdvancedSocketEventTrigger/",
      "dist/nodes/PlugDatabaseClientAccess/PlugDatabaseClientAccess.node.js",
      "dist/nodes/PlugDatabaseUserAccess/PlugDatabaseUserAccess.node.js",
    ],
    legacyCredentialAliases: allowedLegacyCredentialAliases,
  },
];

export const removedSourcePaths = [
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseClientAccess/PlugDatabaseClientAccess.node.ts",
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseUserAccess/PlugDatabaseUserAccess.node.ts",
  "packages/n8n-nodes-plug-database-advanced/package.json",
  "packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAdvancedClientApi.credentials.ts",
  "packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAdvancedUserApi.credentials.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedClientAccess/PlugDatabaseAdvancedClientAccess.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedUserAccess/PlugDatabaseAdvancedUserAccess.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node.ts",
];

export const removedSourceDirectories = [
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseClientAccess",
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseUserAccess",
  "packages/n8n-nodes-plug-database-advanced",
];

export const forbiddenLegacyIdentifiers = [
  "plugDatabaseAdvancedClientApi",
  "plugDatabaseAdvancedUserApi",
  "plugDatabaseAdvancedSocketEventTrigger",
  "plugDatabaseAdvancedPdf",
  "plugDatabaseAdvancedBarcode",
  "PlugDatabaseClientAccess",
  "PlugDatabaseUserAccess",
  "PlugDatabaseAdvancedClientAccess",
  "PlugDatabaseAdvancedUserAccess",
  "PlugDatabaseAdvancedSocketEventTrigger",
  "PlugDatabaseAdvancedPdf",
  "PlugDatabaseAdvancedBarcode",
];

export const bannedIdentifiers = forbiddenLegacyIdentifiers;

export const bannedPathFragments = [
  "PlugDatabaseAdvanced/",
  "PlugDatabaseAdvancedSocketEvent/",
  "PlugDatabaseAdvancedSocketEventTrigger/",
  "PlugDatabaseAdvancedPdf/",
  "PlugDatabaseAdvancedBarcode/",
];

export const rootsToScan = [
  "README.md",
  "docs",
  "packages",
  "scripts",
  "shared",
  "tests",
  ".github",
];

/**
 * Markdown paths (repo-relative, forward slashes) that may document legacy
 * names for migration and therefore skip `bannedIdentifiers` / `bannedPathFragments` scans.
 * Operational docs under `docs/` are still scanned.
 */
export const markdownSurfaceScanSkipRelPaths = new Set([
  "README.md",
  "packages/n8n-nodes-plug-database/README.md",
]);
