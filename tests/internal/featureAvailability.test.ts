import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  ActionIoError,
  callActionIo,
} from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/actionIo/client";
import { callSqlExtension } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/sqlOperation/client";
import { featureUnavailablePresentation } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/featureAvailability";
import { createRestActionIoTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/actionIoTransport";
import { createSocketActionIoTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/actionIoTransport";
import { encodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import { createHttpError } from "../../packages/n8n-nodes-plug-database/generated/shared/auth/sessionHttpErrors";
import { createSocketControlError } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/socketControlErrors";
import { toPlugErrorFromRpcItem } from "../../packages/n8n-nodes-plug-database/generated/shared/output/rpcNormalization";
import { serializeErrorForContinueOnFail } from "../../packages/n8n-nodes-plug-database/generated/shared/output/errorOutput";

const safe = {
  reason: "capability_not_negotiated",
  capability: "agentActions.io",
  origin: "hub",
  recovery: "inspect_capabilities",
  effects_possible: false,
};
describe("unavailable feature presentation", () => {
  it("retains the Hub preflight capability version and safe recovery fields", () => {
    const error = new ActionIoError("CAPABILITY_UNAVAILABLE", false, {
      capability: "agentActions.io v1",
      reason: "disabled",
      origin: "hub",
      phase: "preflight",
      recovery: "local_intervention",
      effects_possible: false,
      outcome_unknown: false,
      retryable: false,
    });
    expect(error.details).toMatchObject({
      capability: "agentActions.io v1",
      reason: "disabled",
      origin: "hub",
      phase: "preflight",
      recovery: "local_intervention",
      outcome_unknown: false,
    });
    expect(error.message).toContain("desativado");
  });
  it.each([
    ["CAPABILITY_UNAVAILABLE", {}, "indisponível"],
    ["CAPABILITY_UNAVAILABLE", { reason: "not_advertised" }, "indisponível"],
    ["CAPABILITY_UNAVAILABLE", { reason: "disabled" }, "desativado"],
    ["CAPABILITY_UNAVAILABLE", { reason: "incompatible" }, "incompatível"],
    ["CAPABILITY_UNAVAILABLE", { reason: "feature_disabled" }, "desativado"],
    [
      "CAPABILITY_UNAVAILABLE",
      { reason: "capability_version_incompatible" },
      "incompatível",
    ],
    ["METHOD_NOT_IMPLEMENTED", {}, "não está implementado"],
    ["RPC_-32601", {}, "não está implementado"],
  ])(
    "presents %s using structured reasons without guessing the agent age",
    (code, details, message) => {
      const error = new ActionIoError(code, true, {
        ...details,
        technical_message: "SECRET",
        message: "SECRET",
      });
      expect(error.message).toContain(message);
      expect(error.description).toContain("não comprova");
      expect(error.retryable).toBe(false);
      expect(JSON.stringify(serializeErrorForContinueOnFail(error))).not.toContain(
        "SECRET",
      );
    },
  );
  it("does not classify prose or timeouts as unavailable or not executed", () => {
    expect(
      featureUnavailablePresentation("TIMEOUT", {
        message: "FEATURE_DISABLED",
        technical_message: "CAPABILITY_UNAVAILABLE",
      }),
    ).toBeUndefined();
    const error = new ActionIoError("SOCKET_TIMEOUT", true);
    expect(error.details?.outcome_unknown).toBe(true);
    expect(
      new ActionIoError("CAPABILITY_UNAVAILABLE", true).details?.outcome_unknown,
    ).toBe(true);
  });
  it.each(["action", "sql"])(
    "preserves explicit JSON-RPC method-not-found for %s without replay",
    async (kind) => {
      const send = vi.fn(async (command) => ({
        jsonrpc: "2.0",
        id: command.id,
        error: {
          code: -32601,
          message: "SECRET",
          data: {
            reason: "method_not_found",
            origin: "agent",
            recovery: "inspect_capabilities",
          },
        },
      }));
      const promise =
        kind === "action"
          ? callActionIo(send, "cancel", { execution_id: "e" }, "token")
          : callSqlExtension(
              send,
              "sql.operation.cancel",
              {
                contractVersion: 1,
                operationId: "018f87c0-1111-7111-8111-123456789abc",
                fingerprint: "a".repeat(64),
                sourcePhysicalId: "b".repeat(64),
                database: "test",
              },
              "token",
            );
      await expect(promise).rejects.toMatchObject({
        code: "RPC_-32601",
        message: expect.stringContaining("não está implementado"),
        details: {
          rpc_code: -32601,
          effects_possible: false,
          outcome_unknown: false,
          origin: "agent",
          reason: "method_not_found",
        },
      });
      expect(send).toHaveBeenCalledOnce();
    },
  );
  it("normalizes the real REST error envelope and keeps safe Hub diagnostics in legacy HTTP too", async () => {
    const body = {
      success: false,
      requestId: "request-1",
      error: {
        code: "CAPABILITY_UNAVAILABLE",
        message: "SECRET",
        details: { ...safe, technical_message: "SECRET", client_token: "SECRET" },
      },
    };
    const fetcher = vi.fn(
      async () => new Response(JSON.stringify(body), { status: 409 }),
    );
    const transport = createRestActionIoTransport({
      endpoint: "http://fixture.invalid",
      agentId: "a",
      bearerToken: () => "hub-token",
      fetch: fetcher as typeof fetch,
    });
    await expect(
      callActionIo(transport, "cancel", { execution_id: "e" }, "agent-token"),
    ).rejects.toMatchObject({
      code: "CAPABILITY_UNAVAILABLE",
      message: expect.stringContaining("indisponível"),
      details: { ...safe, request_id: "request-1", outcome_unknown: false },
    });
    const legacy = createHttpError(503, body, { "Retry-After": "1" });
    expect(legacy).toMatchObject({
      retryable: false,
      correlationId: "request-1",
      details: safe,
    });
    expect(JSON.stringify(serializeErrorForContinueOnFail(legacy))).not.toContain(
      "SECRET",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it.each([false, true])(
    "handles actual PayloadFrame error envelopes for relay=%s",
    async (relay) => {
      class Socket extends EventEmitter {
        connected = true;
        io = { engine: { transport: { writable: true } } };
        volatile = { emit: vi.fn() };
      }
      const socket = new Socket();
      const transport = createSocketActionIoTransport({
        socket,
        agentId: "a",
        relayConversationId: relay ? "c" : undefined,
      });
      const pending = callActionIo(transport, "cancel", { execution_id: "e" }, "token");
      const payload = socket.volatile.emit.mock.calls[0][1];
      const id = relay ? payload.frame.requestId : payload.command.id;
      // Relay request ID is in the logical frame, not necessarily transport metadata.
      const decoded = relay
        ? JSON.parse(Buffer.from(payload.frame.payload).toString())
        : payload.command;
      const body = relay
        ? {
            jsonrpc: "2.0",
            id: decoded.id,
            error: {
              code: -32601,
              message: "SECRET",
              data: { ...safe, reason: "method_not_found" },
            },
          }
        : {
            agentId: "a",
            requestId: id,
            success: false,
            error: { code: "CAPABILITY_UNAVAILABLE", message: "SECRET", details: safe },
          };
      socket.emit(
        relay ? "relay:rpc.response" : "agents:command_response",
        encodePayloadFrame(body),
      );
      await expect(pending).rejects.toMatchObject({
        retryable: false,
        details: {
          effects_possible: false,
          capability: "agentActions.io",
          origin: "hub",
        },
      });
      expect(socket.volatile.emit).toHaveBeenCalledOnce();
      transport.dispose();
    },
  );
  it("treats legacy RPC and control errors consistently without leaking native prose", () => {
    const rpc = toPlugErrorFromRpcItem(
      {
        success: false,
        error: {
          code: -32601,
          message: "SECRET",
          data: {
            reason: "method_not_found",
            user_message: "SECRET",
            technical_message: "SECRET",
          },
        },
      },
      { agentId: "a", requestId: "r" },
    );
    expect(rpc.details).toMatchObject({ rpc_code: -32601, effects_possible: false });
    expect(rpc.message).toContain("não está implementado");
    const control = createSocketControlError(
      {
        code: "CAPABILITY_UNAVAILABLE",
        statusCode: 503,
        message: "SECRET",
        retryAfterSeconds: 1,
        details: { ...safe, reason: "feature_disabled" },
      },
      { defaultCode: "DEFAULT", defaultMessage: "SECRET" },
    );
    expect(control).toMatchObject({
      retryable: false,
      message: expect.stringContaining("desativado"),
    });
    expect(JSON.stringify(serializeErrorForContinueOnFail(rpc))).not.toContain("SECRET");
    expect(JSON.stringify(serializeErrorForContinueOnFail(control))).not.toContain(
      "SECRET",
    );
  });
});
