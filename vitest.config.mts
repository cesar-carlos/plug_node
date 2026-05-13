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
