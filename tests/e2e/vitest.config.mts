import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["./**/*.e2e.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
