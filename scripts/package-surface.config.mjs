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
    maxPackedSizeBytes: 200_000,
    maxUnpackedSizeBytes: 1_200_000,
    manifest: {
      credentials: [
        "dist/credentials/PlugDatabaseAccountApi.credentials.js",
        ...allowedLegacyCredentialAliasPaths,
      ],
      nodes: ["dist/nodes/PlugDatabase/PlugDatabase.node.js"],
    },
    require: [
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
      ...allowedLegacyCredentialAliasPaths,
      "dist/nodes/PlugDatabase/PlugDatabase.node.js",
    ],
    forbid: [
      "dist/tsconfig.tsbuildinfo",
      "dist/generated/shared/socket/",
      "dist/generated/shared/contracts/payload-frame.",
      "dist/nodes/PlugDatabaseClientAccess/PlugDatabaseClientAccess.node.js",
      "dist/nodes/PlugDatabaseUserAccess/PlugDatabaseUserAccess.node.js",
    ],
    legacyCredentialAliases: allowedLegacyCredentialAliases,
  },
  {
    workspace: "n8n-nodes-plug-database-advanced",
    packageName: "n8n-nodes-plug-database-advanced",
    maxPackedSizeBytes: 250_000,
    maxUnpackedSizeBytes: 1_600_000,
    manifest: {
      credentials: [
        "dist/credentials/PlugDatabaseAccountApi.credentials.js",
        ...allowedLegacyCredentialAliasPaths,
        "dist/credentials/PluraAiAutomationsApi.credentials.js",
      ],
      nodes: [
        "dist/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node.js",
        "dist/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node.js",
        "dist/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node.js",
        "dist/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node.js",
        "dist/nodes/PluraAiAutomationsTrigger/PluraAiAutomationsTrigger.node.js",
      ],
    },
    require: [
      "dist/credentials/PlugDatabaseAccountApi.credentials.js",
      ...allowedLegacyCredentialAliasPaths,
      "dist/nodes/PlugDatabaseAdvanced/PlugDatabaseAdvanced.node.js",
      "dist/nodes/PlugDatabaseAdvancedSocketEventTrigger/PlugDatabaseAdvancedSocketEventTrigger.node.js",
    ],
    forbid: [
      "dist/tsconfig.tsbuildinfo",
      "dist/credentials/PlugDatabaseAdvancedClientApi.credentials.js",
      "dist/credentials/PlugDatabaseAdvancedUserApi.credentials.js",
      "dist/nodes/PlugDatabaseAdvancedClientAccess/PlugDatabaseAdvancedClientAccess.node.js",
      "dist/nodes/PlugDatabaseAdvancedUserAccess/PlugDatabaseAdvancedUserAccess.node.js",
      "dist/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node.js",
    ],
    legacyCredentialAliases: allowedLegacyCredentialAliases,
  },
];

export const removedSourcePaths = [
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseClientAccess/PlugDatabaseClientAccess.node.ts",
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseUserAccess/PlugDatabaseUserAccess.node.ts",
  "packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAdvancedClientApi.credentials.ts",
  "packages/n8n-nodes-plug-database-advanced/credentials/PlugDatabaseAdvancedUserApi.credentials.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedClientAccess/PlugDatabaseAdvancedClientAccess.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedUserAccess/PlugDatabaseAdvancedUserAccess.node.ts",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent/PlugDatabaseAdvancedSocketEvent.node.ts",
];

export const removedSourceDirectories = [
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseClientAccess",
  "packages/n8n-nodes-plug-database/nodes/PlugDatabaseUserAccess",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedClientAccess",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedUserAccess",
  "packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedSocketEvent",
];

export const forbiddenLegacyIdentifiers = [
  "plugDatabaseAdvancedClientApi",
  "plugDatabaseAdvancedUserApi",
  "PlugDatabaseClientAccess",
  "PlugDatabaseUserAccess",
  "PlugDatabaseAdvancedClientAccess",
  "PlugDatabaseAdvancedUserAccess",
];

export const bannedIdentifiers = forbiddenLegacyIdentifiers;

export const bannedPathFragments = ["PlugDatabaseAdvancedSocketEvent/"];

export const rootsToScan = [
  "README.md",
  "docs",
  "packages",
  "scripts",
  "shared",
  "tests",
  ".github",
];
