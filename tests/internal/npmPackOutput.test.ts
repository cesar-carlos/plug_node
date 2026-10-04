import { describe, expect, it } from "vitest";
import { readNpmPackOutput } from "../../scripts/npm-pack-output.mjs";

const entry = {
  name: "plug",
  filename: "plug.tgz",
  files: [],
  size: 10,
  unpackedSize: 20,
};
describe("npm pack JSON compatibility", () => {
  it("should accept the legacy array format", () => {
    expect(readNpmPackOutput(JSON.stringify([entry]), "plug")).toEqual(entry);
  });
  it("should accept the npm 12 package map", () => {
    expect(readNpmPackOutput(JSON.stringify({ plug: entry }), "plug")).toEqual(entry);
  });
  it("should reject missing package entries", () => {
    expect(() => readNpmPackOutput(JSON.stringify({ other: entry }), "missing")).toThrow(
      "Unexpected npm pack output",
    );
  });
  it("should reject missing size metadata instead of bypassing size gates", () => {
    expect(() =>
      readNpmPackOutput(JSON.stringify([{ ...entry, size: null }]), "plug"),
    ).toThrow("Unexpected npm pack output");
  });
});
