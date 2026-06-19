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
