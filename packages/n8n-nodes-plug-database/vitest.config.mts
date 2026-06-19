import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["../../tests/public/**/*.test.ts"],
    environment: "node",
    // Forks isolate module cache so vi.mock("socket.io-client") in different files cannot leak.
    pool: "forks",
    // Avoid flaky imports when many workers hit generated/shared on Windows.
    fileParallelism: false,
  },
});
