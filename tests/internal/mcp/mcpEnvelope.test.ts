import { describe, expect, it } from "vitest";

import { PlugTimeoutError, PlugValidationError } from "../../../shared/contracts/errors";
import {
  buildMcpCallResponse,
  buildMcpError,
  extractPlugExecutionResult,
  mapThrownErrorToFriendlyMessage,
} from "../../../shared/mcp/envelope";
import { mapPlugErrorToFriendlyMessage } from "../../../shared/mcp/errorMapper";

describe("mcp envelope", () => {
  it("should detect empty results from plug metadata", () => {
    const extracted = extractPlugExecutionResult([
      {
        rowCount: 0,
        rows: [],
        __plug: { emptyResult: true },
      },
    ]);

    expect(extracted).toEqual({
      rows: [],
      rowCount: 0,
      emptyResult: true,
    });
  });

  it("should build a normalized success envelope with truncated metadata", () => {
    const response = buildMcpCallResponse({
      capability: "consultar_cliente",
      rows: [{ Nome: "Joao" }],
      rowCount: 50,
      maxRows: 50,
      executionMs: 120,
      emptyResult: false,
    });

    expect(response.meta).toMatchObject({
      capability: "consultar_cliente",
      rowCount: 50,
      truncated: true,
      executionMs: 120,
      emptyResult: false,
    });
    expect(JSON.parse(response.content[0].text)).toEqual([{ Nome: "Joao" }]);
  });

  it("should build an error envelope", () => {
    const response = buildMcpError({
      capability: "consultar_cliente",
      message: "Access is not authorized for this capability.",
      executionMs: 15,
    });

    expect(response).toMatchObject({
      isError: true,
      content: [{ type: "text", text: "Access is not authorized for this capability." }],
    });
  });
});

describe("mcp errorMapper", () => {
  it("should map plug validation errors to friendly messages", () => {
    expect(
      mapPlugErrorToFriendlyMessage(new PlugValidationError("Named param missing")),
    ).toBe("The provided parameters are not valid for this capability.");
  });

  it("should map timeout and agent offline errors", () => {
    expect(mapPlugErrorToFriendlyMessage(new PlugTimeoutError("Timed out"))).toBe(
      "The query took longer than expected. Please try again.",
    );

    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugValidationError("Agent offline", {
          details: { reason: "agent_offline" },
        }),
      ),
    ).toBe("The ERP system is temporarily unavailable. Please try again shortly.");

    expect(mapThrownErrorToFriendlyMessage(new Error("Unexpected"))).toBe("Unexpected");
  });
});
