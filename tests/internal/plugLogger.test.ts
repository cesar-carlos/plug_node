import { beforeEach, describe, expect, it, vi } from "vitest";

const loggerProxy = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
}));

vi.mock("n8n-workflow", () => ({
  LoggerProxy: loggerProxy,
}));

describe("plugLogger", () => {
  it("should keep sanitized metadata free of inherited server properties", async () => {
    const { plugLogger } = await import("../../shared/logging/plugLogger");
    const metadata = JSON.parse(
      '{"requestId":"fixture","__proto__":{"unexpected":"value","password":"fixture"}}',
    ) as Record<string, unknown>;
    plugLogger.info("fixture", metadata);
    const sanitized = loggerProxy.info.mock.calls[0][1] as Record<string, unknown>;
    expect(sanitized).toEqual({ requestId: "fixture" });
    expect(Object.getPrototypeOf(sanitized)).toBe(Object.prototype);
    expect(sanitized.unexpected).toBeUndefined();
  });

  it("should omit undefined metadata while preserving recursive redaction and input values", async () => {
    const { plugLogger } = await import("../../shared/logging/plugLogger");
    const metadata = {
      empty: undefined,
      nested: [{ accessToken: "fixture", value: 1 }],
      requestId: "fixture",
    };
    plugLogger.info("fixture", metadata);
    expect(loggerProxy.info).toHaveBeenCalledWith("[plug-node] fixture", {
      nested: [{ accessToken: "[redacted]", value: 1 }],
      requestId: "fixture",
    });
    expect(metadata.nested[0].accessToken).toBe("fixture");
    plugLogger.debug("empty", { value: undefined });
    expect(loggerProxy.debug).toHaveBeenCalledWith("[plug-node] empty", undefined);
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts sensitive metadata keys before logging", async () => {
    const { plugLogger } = await import("../../shared/logging/plugLogger");

    plugLogger.warn("security.test.redaction", {
      password: "secret-password",
      refreshToken: "refresh-token",
      clientToken: "client-token",
      payloadSigningKey: "signing-key",
      token: "access-token",
      nested: {
        authorization: "Bearer api-key",
      },
      requestId: "request-1",
    });

    expect(loggerProxy.warn).toHaveBeenCalledWith("[plug-node] security.test.redaction", {
      password: "[redacted]",
      refreshToken: "[redacted]",
      clientToken: "[redacted]",
      payloadSigningKey: "[redacted]",
      token: "[redacted]",
      nested: {
        authorization: "[redacted]",
      },
      requestId: "request-1",
    });
  });
});
