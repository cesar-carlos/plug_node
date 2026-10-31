import { describe, expect, it } from "vitest";

import { validatePublishedArtifacts } from "../../scripts/package-artifacts.mjs";

const runtime = [
  "dist/nodes/Example.node.js",
  "dist/nodes/Example.node.d.ts",
  "dist/nodes/icon.svg",
  "dist/generated/schema.json",
];
const built = [...runtime, "dist/nodes/Example.node.js.map"];

describe("published runtime artifacts", () => {
  it("should omit only development source maps and retain all runtime artifacts", () => {
    expect(() =>
      validatePublishedArtifacts(built, [...runtime, "README.md", "package.json"]),
    ).not.toThrow();
  });

  it.each(runtime)("should reject omission of %s", (missing) => {
    expect(() =>
      validatePublishedArtifacts(
        built,
        runtime.filter((file) => file !== missing),
      ),
    ).toThrow("Built artifact missing");
  });

  it("should reject new runtime asset types until the npm allowlist includes them", () => {
    expect(() =>
      validatePublishedArtifacts([...built, "dist/nodes/decoder.wasm"], runtime),
    ).toThrow("decoder.wasm");
  });

  it("should reject reintroduced source maps", () => {
    expect(() => validatePublishedArtifacts(built, built)).toThrow(
      "Development source map",
    );
  });

  it("should reject stale artifacts absent from the build", () => {
    expect(() =>
      validatePublishedArtifacts(built, [...runtime, "dist/removed.js"]),
    ).toThrow("absent from the current build");
  });
});
