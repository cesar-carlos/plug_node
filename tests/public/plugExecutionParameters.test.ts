import { describe, expect, it } from "vitest";

import {
  toCappedPositiveInteger,
  toCollection,
  toOptionalBoolean,
  toOptionalPositiveInteger,
  toOptionalPositiveNumber,
  toOptionalString,
  toPositiveInteger,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugExecutionParameters";
import { createMockExecuteContext } from "../helpers/mockExecuteFunctions";

describe("plugExecutionParameters", () => {
  it("normalizes optional strings", () => {
    expect(toOptionalString("  agent-1  ")).toBe("agent-1");
    expect(toOptionalString("   ")).toBeUndefined();
    expect(toOptionalString(42)).toBeUndefined();
  });

  it("accepts only finite positive numbers", () => {
    expect(toOptionalPositiveNumber(15000)).toBe(15000);
    expect(toOptionalPositiveNumber(0)).toBeUndefined();
    expect(toOptionalPositiveNumber(-1)).toBeUndefined();
    expect(toOptionalPositiveNumber(Number.NaN)).toBeUndefined();
  });

  it("normalizes optional positive integers with validation", () => {
    expect(toOptionalPositiveInteger(2.9, "Page")).toBe(2);
    expect(toOptionalPositiveInteger(undefined, "Page")).toBeUndefined();
    expect(() => toOptionalPositiveInteger(-1, "Page")).toThrow(
      "Page must be a positive number",
    );
  });

  it("reads booleans strictly", () => {
    expect(toOptionalBoolean(true)).toBe(true);
    expect(toOptionalBoolean(false)).toBe(false);
    expect(toOptionalBoolean("true")).toBeUndefined();
  });

  it("normalizes positive integers with validation", () => {
    expect(toPositiveInteger(4, 1, "Max Rows")).toBe(4);
    expect(toPositiveInteger(undefined, 10, "Max Rows")).toBe(10);
    expect(() => toPositiveInteger(1.5, 1, "Max Rows")).toThrow(
      "Max Rows must be an integer",
    );
    expect(() => toPositiveInteger(-1, 1, "Max Rows")).toThrow(
      "Max Rows must be a positive number",
    );
  });

  it("caps positive integers at hard limits", () => {
    expect(toCappedPositiveInteger(100, 50, "Max Size", 200)).toBe(100);
    expect(() => toCappedPositiveInteger(300, 50, "Max Size", 200)).toThrow(
      "Max Size must be less than or equal to 200 bytes",
    );
  });

  it("reads node parameter collections", () => {
    const context = createMockExecuteContext({
      credentials: {
        user: "u",
        password: "p",
        baseUrl: "https://plug-server.example.com/api/v1",
      },
      parameters: {
        sqlOptions: { timeoutMs: 5000, maxRows: 10 },
      },
      responses: [],
    });

    expect(toCollection(context, "sqlOptions", 0)).toEqual({
      timeoutMs: 5000,
      maxRows: 10,
    });
  });
});
