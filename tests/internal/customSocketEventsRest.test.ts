import { describe, expect, it } from "vitest";

import { publishCustomSocketEvent } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/customSocketEvents";
import type {
  PlugHttpRequester,
  PlugSession,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { PlugValidationError } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/errors";

const session: PlugSession = {
  credentials: {
    user: "client@example.com",
    password: "secret",
    baseUrl: "https://plug-server.example.com/api/v1",
  },
  accessToken: "access-1",
  refreshToken: "refresh-1",
  loginResponse: {
    accessToken: "access-1",
    refreshToken: "refresh-1",
    client: {
      id: "client-1",
      userId: "user-1",
      email: "client@example.com",
      name: "Plug",
      lastName: "Client",
      status: "active",
      role: "client",
    },
  },
};

describe("R2-B-01: publishCustomSocketEvent invalid JSON response", () => {
  it("preserves the SyntaxError message as technicalMessage", async () => {
    const requester: PlugHttpRequester = async () => ({
      statusCode: 202,
      headers: {},
      // Looks like JSON (starts with `{`) but is malformed.
      body: '{"eventName": invalid',
    });

    try {
      await publishCustomSocketEvent(requester, session, {
        eventName: "client:custom.test",
        payload: { ok: true },
      });
      expect.fail("expected publishCustomSocketEvent to throw");
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(PlugValidationError);
      const validation = error as PlugValidationError;
      expect(validation.message).toMatch(/must be valid JSON/);
      expect(validation.technicalMessage).toBeTypeOf("string");
      expect(validation.technicalMessage).not.toBe("");
    }
  });
});
