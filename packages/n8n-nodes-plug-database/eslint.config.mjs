import { configWithoutCloudSupport } from "@n8n/node-cli/eslint";

export default [
  ...configWithoutCloudSupport,
  {
    files: ["credentials/PlugAgentApi.credentials.ts"],
    rules: {
      // A local agent token has no standalone HTTP endpoint: it needs the separate
      // Hub credential and a selected operation/action scope. Validate Run performs
      // that read-only check. Remove when n8n supports a two-credential test.
      "@n8n/community-nodes/credential-test-required": "off",
    },
  },
  {
    files: ["package.json"],
    rules: {
      // Self-hosted native tools cannot use the Cloud dependency prohibition.
      // prelint enforces the tested, exactly pinned allowlist instead. Remove this
      // exception when the upstream self-hosted preset supports runtime dependencies.
      "@n8n/community-nodes/no-runtime-dependencies": "off",
    },
  },
  {
    files: ["generated/shared/**/*.ts", "nodes/**/*.ts"],
    ignores: ["nodes/**/*.node.ts"],
    rules: {
      // Protocol helpers preserve typed errors for retries; node entry points
      // convert them to n8n errors. Remove when upstream supports that boundary.
      "@n8n/community-nodes/require-node-api-error": "off",
    },
  },
  {
    files: ["../../shared/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/packages/**", "packages/**"],
              message: "shared must not import from packages/**.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.ts"],
    ignores: ["generated/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["../../shared/**", "../../../shared/**", "shared/**"],
              message: "Import shared code via generated/shared paths.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["nodes/**/*.node.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "socket.io-client",
              message:
                "Keep Socket.IO usage behind package-local transport adapters.",
            },
          ],
          patterns: [
            {
              group: ["../../shared/**", "../../../shared/**", "shared/**"],
              message: "Import shared code via generated/shared paths.",
            },
          ],
        },
      ],
    },
  },
];
