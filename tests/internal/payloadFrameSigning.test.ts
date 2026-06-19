import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import { resolvePayloadFrameSigning } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/payloadFrameSigning";

const baseCredentials = {
  user: "u",
  password: "p",
  baseUrl: "https://example.com/api/v1",
};

describe("resolvePayloadFrameSigning", () => {
  it("includes previous signing keys from credential JSON", () => {
    const signing = resolvePayloadFrameSigning({
      ...baseCredentials,
      payloadSigningKey: "current-key",
      payloadSigningKeyId: "current-id",
      payloadSigningPreviousKeysJson: JSON.stringify([
        { key: "old-key", keyId: "old-id" },
      ]),
    });

    expect(signing).toMatchObject({
      key: "current-key",
      keyId: "current-id",
      previousKeys: [{ key: "old-key", keyId: "old-id" }],
    });
  });

  it("accepts previous keys as a keyId-to-key object", () => {
    const signing = resolvePayloadFrameSigning({
      ...baseCredentials,
      payloadSigningPreviousKeysJson: JSON.stringify({
        "legacy-id": "legacy-key",
      }),
    });

    expect(signing?.previousKeys).toEqual([{ key: "legacy-key", keyId: "legacy-id" }]);
  });

  it("rejects invalid previous key JSON", () => {
    expect(() =>
      resolvePayloadFrameSigning({
        ...baseCredentials,
        payloadSigningPreviousKeysJson: "{not-json",
      }),
    ).toThrow(PlugValidationError);
  });

  it("rejects previous key entries without a key field", () => {
    expect(() =>
      resolvePayloadFrameSigning({
        ...baseCredentials,
        payloadSigningPreviousKeysJson: JSON.stringify([{ keyId: "missing-key" }]),
      }),
    ).toThrow(/non-empty key/i);
  });

  it("returns signing options when signature enforcement is required", () => {
    const signing = resolvePayloadFrameSigning(
      {
        ...baseCredentials,
        payloadSigningKey: "required-key",
      },
      { requireSignature: true },
    );

    expect(signing).toMatchObject({
      key: "required-key",
      requireSignature: true,
    });
  });

  it("returns undefined when no signing material is configured", () => {
    expect(resolvePayloadFrameSigning(baseCredentials)).toBeUndefined();
  });
});
