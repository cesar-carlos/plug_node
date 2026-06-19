import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import {
  generateHash,
  hmacSign,
} from "../../packages/n8n-nodes-plug-database/generated/shared/tools/security";

describe("security tools", () => {
  it("allows sha256 and sha512 digests", () => {
    expect(generateHash("plug", "sha256")).toBe(
      "0daf0c9ca37fec6e1d5a340073fb43a19c89c50c02827c9991295f89987c7c90",
    );
    expect(hmacSign("plug", "secret", "sha512")).toHaveLength(128);
  });

  it("rejects unsupported digest algorithms", () => {
    expect(() => generateHash("plug", "md5")).toThrow(PlugValidationError);
    expect(() => hmacSign("plug", "secret", "sha1")).toThrow(PlugValidationError);
  });
});
