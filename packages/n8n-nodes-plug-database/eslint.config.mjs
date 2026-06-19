import { configWithoutCloudSupport } from "@n8n/node-cli/eslint";

export default [
  ...configWithoutCloudSupport,
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
