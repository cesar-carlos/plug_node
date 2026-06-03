import { describe, expect, it } from "vitest";

import {
  toCollection,
  toOptionalBoolean,
  toOptionalPositiveNumber,
  toOptionalString,
} from "../../shared/n8n/plugExecutionParameters";
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

  it("reads booleans strictly", () => {
    expect(toOptionalBoolean(true)).toBe(true);
    expect(toOptionalBoolean(false)).toBe(false);
    expect(toOptionalBoolean("true")).toBeUndefined();
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
