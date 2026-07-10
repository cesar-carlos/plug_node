import { describe, expect, it } from "vitest";

import {
  PlugError,
  PlugTimeoutError,
  PlugValidationError,
} from "../../../shared/contracts/errors";
import { mapPlugErrorToFriendlyMessage } from "../../../shared/mcp/errorMapper";

describe("mcp errorMapper", () => {
  it("should map plug validation errors to friendly messages", () => {
    expect(
      mapPlugErrorToFriendlyMessage(new PlugValidationError("Named param missing")),
    ).toBe("The provided parameters are not valid for this capability.");
  });

  it("should map timeout errors to friendly messages", () => {
    expect(mapPlugErrorToFriendlyMessage(new PlugTimeoutError("Timed out"))).toBe(
      "The query took longer than expected. Please try again.",
    );
  });

  it("should map agent offline and denied resource reasons before generic codes", () => {
    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugValidationError("Agent offline", {
          details: { reason: "agent_offline" },
        }),
      ),
    ).toBe("The ERP system is temporarily unavailable. Please try again shortly.");

    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugError("Denied", {
          code: "PLUG_FORBIDDEN",
          details: { reason: "denied_resources" },
        }),
      ),
    ).toBe("This capability is not authorized for the current access profile.");
  });

  it("should map http status codes to friendly messages", () => {
    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugError("Forbidden", { code: "HTTP_FORBIDDEN", statusCode: 403 }),
      ),
    ).toBe("Access is not authorized for this capability.");

    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugError("Too many requests", { code: "HTTP_TOO_MANY", statusCode: 429 }),
      ),
    ).toBe("Too many requests in sequence. Please wait a moment.");

    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugError("Unauthorized", { code: "HTTP_UNAUTHORIZED", statusCode: 401 }),
      ),
    ).toBe(
      "Authentication failed for this capability. Check credentials or session and try again.",
    );
  });

  it("should fall back to a generic friendly message for unmapped plug errors", () => {
    expect(
      mapPlugErrorToFriendlyMessage(
        new PlugError("rpc internal failure xyz", { code: "PLUG_UNKNOWN" }),
      ),
    ).toBe("An unexpected error occurred while executing the capability.");
  });

  it("should fall back to generic error messages for unknown values", () => {
    expect(mapPlugErrorToFriendlyMessage(new Error("Unexpected"))).toBe(
      "An unexpected error occurred while executing the capability.",
    );
    expect(mapPlugErrorToFriendlyMessage({ message: "Structured failure" })).toBe(
      "An unexpected error occurred while executing the capability.",
    );
    expect(mapPlugErrorToFriendlyMessage(42)).toBe(
      "An unexpected error occurred while executing the capability.",
    );
  });
});
