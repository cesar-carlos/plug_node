import { describe, expect, it } from "vitest";

import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";
import { validateJsonSchema } from "../../packages/n8n-nodes-plug-database/generated/shared/tools/data";

describe("validateJsonSchema", () => {
  it("accepts valid payloads against an object schema", () => {
    const result = validateJsonSchema(
      { id: 1, name: "Alpha" },
      {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "number" },
          name: { type: "string" },
        },
      },
    );

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("returns ajv errors for invalid payloads", () => {
    const result = validateJsonSchema(
      { id: "not-a-number" },
      {
        type: "object",
        properties: {
          id: { type: "number" },
        },
      },
    );

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("supports boolean schemas", () => {
    expect(validateJsonSchema({ any: "value" }, true).valid).toBe(true);
    expect(validateJsonSchema({ any: "value" }, false).valid).toBe(false);
  });

  it("parses string schemas as JSON", () => {
    const result = validateJsonSchema(
      { ok: true },
      '{"type":"object","required":["ok"],"properties":{"ok":{"type":"boolean"}}}',
    );

    expect(result.valid).toBe(true);
  });

  it("rejects non-object non-boolean schemas", () => {
    expect(() => validateJsonSchema({}, "[]")).toThrow(
      /JSON Schema must be a JSON object or boolean schema/i,
    );
  });
});
