import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/public/**/*.test.ts", "tests/internal/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      reporter: ["text", "html", "lcov"],
      include: [
        "packages/*/generated/shared/auth/**/*.ts",
        "packages/*/generated/shared/output/**/*.ts",
        "packages/*/generated/shared/socket/**/*.ts",
        "packages/*/generated/shared/n8n/**/*.ts",
      ],
      exclude: ["**/*.d.ts", "packages/*/generated/shared/contracts/**/*.ts"],
    },
  },
});
