import { describe, expect, it } from "vitest";

import {
  assertNumber,
  assertOptionalString,
  assertRecord,
  assertRecordArray,
  assertString,
  assertStringArray,
} from "../../packages/n8n-nodes-plug-database/generated/shared/rest/parseHelpers";
import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";

describe("R2-S-01: shared parseHelpers", () => {
  describe("assertRecord", () => {
    it("returns the value when it is a plain object", () => {
      const value = { agentId: "abc" };
      expect(assertRecord(value, "Agent")).toBe(value);
    });

    it("throws PlugValidationError for arrays", () => {
      expect(() => assertRecord([], "Agent")).toThrow(PlugValidationError);
    });

    it("throws PlugValidationError for null", () => {
      expect(() => assertRecord(null, "Agent")).toThrow(/Agent must be an object/);
    });
  });

  describe("assertString", () => {
    it("returns the string when non-empty", () => {
      expect(assertString("abc", "Name")).toBe("abc");
    });

    it("rejects empty and whitespace-only strings", () => {
      expect(() => assertString("", "Name")).toThrow(PlugValidationError);
      expect(() => assertString("   ", "Name")).toThrow(
        /Name must be a non-empty string/,
      );
    });

    it("rejects non-string types", () => {
      expect(() => assertString(123, "Name")).toThrow(PlugValidationError);
    });
  });

  describe("assertNumber", () => {
    it("accepts finite numbers including zero and negatives", () => {
      expect(assertNumber(0, "Count")).toBe(0);
      expect(assertNumber(-5, "Count")).toBe(-5);
      expect(assertNumber(3.14, "Count")).toBe(3.14);
    });

    it("rejects NaN and Infinity", () => {
      expect(() => assertNumber(Number.NaN, "Count")).toThrow(PlugValidationError);
      expect(() => assertNumber(Number.POSITIVE_INFINITY, "Count")).toThrow(/Count/);
    });
  });

  describe("assertStringArray", () => {
    it("validates every element", () => {
      expect(assertStringArray(["a", "b"], "Items")).toEqual(["a", "b"]);
    });

    it("reports the failing index in the error", () => {
      expect(() => assertStringArray(["a", ""], "Items")).toThrow(/Items\[1\]/);
    });
  });

  describe("assertRecordArray", () => {
    it("returns a typed array of records", () => {
      const value = [{ id: "1" }, { id: "2" }];
      expect(assertRecordArray<{ id: string }>(value, "Items")).toEqual(value);
    });

    it("throws when any element is not an object", () => {
      expect(() => assertRecordArray([{}, "no"], "Items")).toThrow(/Items\[1\]/);
    });
  });

  describe("assertOptionalString", () => {
    it("passes through null and undefined unchanged", () => {
      expect(assertOptionalString(null)).toBeNull();
      expect(assertOptionalString(undefined)).toBeUndefined();
    });

    it("returns the string when it is a string", () => {
      expect(assertOptionalString("token")).toBe("token");
    });

    it("returns undefined for non-string non-nullish values", () => {
      expect(assertOptionalString(42)).toBeUndefined();
    });
  });
});
