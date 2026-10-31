import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/public/**/*.test.ts", "tests/internal/**/*.test.ts"],
    environment: "node",
    // Forks isolate module cache so vi.mock("socket.io-client") in different files cannot leak.
    pool: "forks",
    // Avoid flaky imports when many workers hit generated/shared on Windows.
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov", "json-summary"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 80,
        branches: 70,
        "**/shared/auth/**/*.ts": {
          lines: 85,
          statements: 85,
          functions: 90,
          branches: 75,
        },
        "**/shared/contracts/**/*.ts": {
          lines: 75,
          statements: 75,
          functions: 95,
          branches: 75,
        },
        "**/shared/socket/**/*.ts": {
          lines: 80,
          statements: 80,
          functions: 80,
          branches: 75,
        },
        "**/shared/mcp/**/*.ts": {
          lines: 70,
          statements: 70,
          functions: 80,
          branches: 60,
        },
      },
      include: [
        "packages/*/generated/shared/auth/**/*.ts",
        "shared/mcp/**/*.ts",
        "packages/*/generated/shared/mcp/**/*.ts",
        "packages/*/generated/shared/contracts/**/*.ts",
        "packages/*/generated/shared/output/**/*.ts",
        "packages/*/generated/shared/socket/**/*.ts",
        "packages/*/generated/shared/n8n/**/*.ts",
        "packages/n8n-nodes-plug-database/nodes/**/*.ts",
      ],
      exclude: ["**/*.d.ts"],
      // Policy modules are also exercised directly from the source tree.
    },
  },
});
