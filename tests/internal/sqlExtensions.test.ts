import { describe, expect, it, vi } from "vitest";
import { callSqlExtension } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/sqlOperation/client";
import { sqlOperationExecuteParamsSchema } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/sqlOperation/params";
import { sourceSchemaParamsSchema } from "../../packages/n8n-nodes-plug-database/generated/shared/contracts/sqlOperation/schema";
import { createSocketActionIoTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/actionIoTransport";
import { EventEmitter } from "node:events";
import { createRestActionIoTransport } from "../../packages/n8n-nodes-plug-database/generated/shared/rest/actionIoTransport";
import { decodePayloadFrame } from "../../packages/n8n-nodes-plug-database/generated/shared/socket/payloadFrameCodec";
import {
  sqlExecuteParamsSchema,
  sqlExecuteBatchParamsSchema,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugAdvancedJsonRpcMethodSchemas";

const reference = {
  contractVersion: 1,
  operationId: "018f87c0-1111-7111-8111-123456789abc",
  fingerprint: "a".repeat(64),
  sourcePhysicalId: "b".repeat(64),
  database: "fixture",
};
const plan = {
  ...reference,
  timeoutMs: 300000,
  maxAffectedRows: 1,
  steps: [
    {
      id: "write",
      effect: "update",
      sql: "UPDATE fixture SET x = :x",
      params: {
        x: { kind: "value", scalar: { type: "integer", value: "9007199254740993" } },
      },
      outputs: {},
      affectedRows: { min: 1, max: 1 },
    },
  ],
};
describe("SQL extension lifecycle", () => {
  it("applies the 2 MiB SQL limit to UTF-8 params including the credential", async () => {
    const input = {
      ...plan,
      steps: [{ ...plan.steps[0] }, { ...plan.steps[0], id: "second" }],
    };
    const token = 'ação"\\';
    const remaining =
      2 * 1024 * 1024 -
      Buffer.byteLength(JSON.stringify({ ...input, client_token: token }));
    input.steps[0].sql += "x".repeat(Math.floor(remaining / 2));
    input.steps[1].sql += "x".repeat(Math.ceil(remaining / 2));
    const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const wire = JSON.parse(String(init?.body));
      expect(wire.command.params).toEqual({ ...input, client_token: token });
      return Response.json({
        agentId: "a",
        response: {
          type: "single",
          item: {
            id: wire.command.id,
            success: true,
            result: {
              operationId: input.operationId,
              fingerprint: input.fingerprint,
              executionId: "e",
              state: "concluida",
              directlyAffectedRows: 1,
              updatedAt: "2026-01-01T00:00:00Z",
            },
          },
        },
      });
    });
    const send = createRestActionIoTransport({
      endpoint: "http://fixture.invalid",
      agentId: "a",
      bearerToken: () => "hub",
      fetch: fetcher,
    });
    await expect(
      callSqlExtension(send, "sql.operation.execute", input, token),
    ).resolves.toMatchObject({ state: "concluida" });
    input.steps[1].sql += "x";
    await expect(
      callSqlExtension(send, "sql.operation.execute", input, token),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      details: { outcome_unknown: false },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])(
    "checks the complete SQL command before Socket dispatch relay=%s",
    async (relay) => {
      class Socket extends EventEmitter {
        connected = true;
        io = { engine: { transport: { writable: true } } };
        volatile = { emit: vi.fn() };
      }
      const socket = new Socket();
      const params = { ...reference, client_token: 'ação"\\' };
      const method = "sql.operation.get";
      const command = { jsonrpc: "2.0", id: "x".repeat(36), method, params };
      const size = Buffer.byteLength(JSON.stringify(command));
      const make = (maxRequestBytes: number) =>
        createSocketActionIoTransport({
          socket,
          agentId: "a",
          relayConversationId: relay ? "c" : undefined,
          maxRequestBytes,
        });
      const small = make(size - 1);
      await expect(
        callSqlExtension(small, method, reference, params.client_token),
      ).rejects.toMatchObject({ code: "SOCKET_REQUEST_TOO_LARGE" });
      small.dispose();
      expect(socket.volatile.emit).not.toHaveBeenCalled();
      const exact = make(size);
      const checked = expect(
        callSqlExtension(exact, method, reference, params.client_token),
      ).rejects.toMatchObject({ code: "SOCKET_DISCONNECTED" });
      const wire = socket.volatile.emit.mock.calls[0][1];
      expect(relay ? decodePayloadFrame(wire.frame).data : wire.command).toEqual({
        ...command,
        id: expect.any(String),
      });
      socket.emit("disconnect");
      await checked;
      exact.dispose();
    },
  );
  it("enforces proven structure, positive write bounds and unique step identities", () => {
    const expectedSource = { version: 1, dialect: "mssql", identityHash: "a".repeat(64) };
    const resource = {
      resource: { schema: "dbo", name: "t", type: "table" },
      columns: [{ name: "id", nativeType: "int", nullable: false, size: 4, scale: 0 }],
      constraints: {
        primaryKeys: [{ name: "pk", columns: ["id"], status: "enabled" }],
        uniqueKeys: [],
        foreignKeys: [],
      },
    };
    const guarded = {
      ...plan,
      expectedSource,
      expectedStructure: { version: 1, resources: [resource] },
    };
    expect(sqlOperationExecuteParamsSchema.safeParse(guarded).success).toBe(true);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({ ...guarded, expectedSource: undefined })
        .success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({
        ...guarded,
        expectedStructure: {
          version: 1,
          resources: [
            { ...resource, columns: [{ ...resource.columns[0], nullable: null }] },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({
        ...guarded,
        expectedStructure: {
          version: 1,
          resources: [
            {
              ...resource,
              constraints: {
                ...resource.constraints,
                primaryKeys: [
                  { ...resource.constraints.primaryKeys[0], status: "unknown" },
                ],
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({
        ...plan,
        steps: [plan.steps[0], plan.steps[0]],
      }).success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({
        ...plan,
        steps: [{ ...plan.steps[0], affectedRows: undefined }],
      }).success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({
        ...plan,
        steps: [{ ...plan.steps[0], effect: "select", affectedRows: undefined }],
      }).success,
    ).toBe(false);
  });
  it("correlates source identity, requested resources and pagination before accepting metadata", async () => {
    const identity = {
      contractVersion: 1,
      database: "fixture",
      dialect: "mssql",
      identityHash: "a".repeat(64),
      identityKind: "native",
      engineVersion: "test",
      verifiedAt: "2026-10-30T12:00:00Z",
    };
    const resource = { schema: "dbo", name: "t", type: "table" };
    const params = {
      contractVersion: 1,
      database: "fixture",
      expectedSource: {
        version: 1,
        dialect: identity.dialect,
        identityHash: identity.identityHash,
      },
      resources: [resource],
      offset: 0,
      pageSize: 1,
    };
    const result = {
      contractVersion: 1,
      identity,
      observedAt: "2026-10-30T12:00:00Z",
      resources: [
        {
          resource,
          status: "available",
          columns: [],
          primaryKeys: [],
          foreignKeys: [],
          coverage: {
            columns: true,
            primaryKeys: true,
            foreignKeys: true,
            constraintStatus: true,
          },
          limitations: [],
        },
      ],
      metadataPage: { offset: 0, pageSize: 1, nextOffset: null },
    };
    const send = vi.fn(async (command) => ({ jsonrpc: "2.0", id: command.id, result }));
    await expect(
      callSqlExtension(send, "sql.describeSchema", params, "token"),
    ).resolves.toMatchObject({ identity });
    await expect(
      callSqlExtension(
        send,
        "sql.describeSchema",
        {
          ...params,
          expectedSource: { ...params.expectedSource, identityHash: "b".repeat(64) },
        },
        "token",
      ),
    ).rejects.toMatchObject({ code: "RESULT_IDENTITY_MISMATCH" });
    await expect(
      callSqlExtension(
        send,
        "sql.describeSchema",
        { ...params, resources: [{ ...resource, name: "other" }] },
        "token",
      ),
    ).rejects.toMatchObject({ code: "RESULT_IDENTITY_MISMATCH" });
    await expect(
      callSqlExtension(send, "sql.describeSchema", { ...params, offset: 1 }, "token"),
    ).rejects.toMatchObject({ code: "INVALID_REQUEST" });
    await expect(
      callSqlExtension(
        async (command) => ({ jsonrpc: "2.0", id: command.id, result: identity }),
        "sql.describeSource",
        { contractVersion: 1, database: "other" },
        "token",
      ),
    ).rejects.toMatchObject({ code: "RESULT_IDENTITY_MISMATCH" });
  });
  it("preserves source guards in legacy advanced SQL and rejects fractional batch concurrency", () => {
    const expectedSource = { version: 1, dialect: "mssql", identityHash: "a".repeat(64) };
    const expectedStructure = {
      version: 1,
      resources: [
        {
          resource: { schema: "dbo", name: "t", type: "table" },
          columns: [
            { name: "id", nativeType: "int", nullable: false, size: 4, scale: 0 },
          ],
        },
      ],
    };
    expect(
      sqlExecuteParamsSchema.parse({
        sql: "SELECT id FROM dbo.t",
        expectedSource,
        expectedStructure,
      }),
    ).toMatchObject({ expectedSource, expectedStructure });
    expect(
      sqlExecuteParamsSchema.safeParse({ sql: "SELECT 1", expectedStructure }).success,
    ).toBe(false);
    expect(
      sqlExecuteBatchParamsSchema.safeParse({
        commands: [{ sql: "SELECT 1" }],
        options: { max_parallel_read_only_batch_items: 1.5 },
      }).success,
    ).toBe(false);
  });
  it("preserves stable identity and large integer scalars without coercion", async () => {
    const send = vi.fn(async (command) => {
      expect(command.params.operationId).toBe(reference.operationId);
      expect(command.params.steps[0].params.x.scalar.value).toBe("9007199254740993");
      return {
        jsonrpc: "2.0",
        id: command.id,
        result: {
          operationId: reference.operationId,
          fingerprint: reference.fingerprint,
          executionId: "e",
          state: "executando",
          directlyAffectedRows: null,
          updatedAt: "2026-10-30T12:00:00Z",
        },
      };
    });
    expect(
      (await callSqlExtension(send, "sql.operation.execute", plan, "token")).state,
    ).toBe("executando");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it.each(["sql.operation.execute", "sql.operation.cancel"])(
    "does not replay %s after ambiguous dispatch",
    async (method) => {
      const send = vi.fn().mockRejectedValue(new Error("native credential leak"));
      await expect(
        callSqlExtension(
          send,
          method,
          method.endsWith("execute") ? plan : reference,
          "token",
        ),
      ).rejects.toMatchObject({ retryable: false, details: { outcome_unknown: true } });
      expect(send).toHaveBeenCalledTimes(1);
    },
  );
  it("preserves structured SQL errors and nullable confirmed progress", async () => {
    const send = vi.fn(async (command) => ({
      jsonrpc: "2.0",
      id: command.id,
      error: {
        code: -32000,
        message: "failure",
        data: {
          operationId: reference.operationId,
          fingerprint: reference.fingerprint,
          failureCode: "SQL_OPERATION_TIMEOUT",
          outcome: "resultado_desconhecido",
          effects_possible: true,
          confirmed_bytes: null,
        },
      },
    }));
    await expect(
      callSqlExtension(send, "sql.operation.cancel", reference, "token"),
    ).rejects.toMatchObject({
      details: {
        operationId: reference.operationId,
        failureCode: "SQL_OPERATION_TIMEOUT",
        outcome: "resultado_desconhecido",
        confirmed_bytes: null,
      },
    });
  });
  it("checks exact statement byte bounds, row limits and prior output bindings", () => {
    const withSql = (sql: string) => ({ ...plan, steps: [{ ...plan.steps[0], sql }] });
    expect(
      sqlOperationExecuteParamsSchema.safeParse(withSql("x".repeat(1048576))).success,
    ).toBe(true);
    expect(
      sqlOperationExecuteParamsSchema.safeParse(withSql("x".repeat(1048577))).success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse(withSql("é".repeat(524289))).success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({ ...plan, maxAffectedRows: 100001 })
        .success,
    ).toBe(false);
    expect(
      sqlOperationExecuteParamsSchema.safeParse({
        ...plan,
        steps: [
          {
            ...plan.steps[0],
            params: { x: { kind: "step_output", stepId: "later", output: "x" } },
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires source identity for schema inspection and refuses unknown operations", async () => {
    expect(
      sourceSchemaParamsSchema.safeParse({
        contractVersion: 1,
        database: "fixture",
        resources: [{ schema: "dbo", name: "t", type: "table" }],
        offset: 0,
        pageSize: 1,
        client_token: "token",
      }).success,
    ).toBe(false);
    const send = vi.fn();
    await expect(
      callSqlExtension(send, "sql.operation.fast", reference, "token"),
    ).rejects.toMatchObject({ details: { outcome_unknown: false } });
    expect(send).not.toHaveBeenCalled();
  });
  it("does not mistake static discovery or a transport ACK for negotiation or results", async () => {
    const send = vi.fn(async (command) => ({
      jsonrpc: "2.0",
      id: command.id,
      result: { accepted: true },
    }));
    await expect(
      callSqlExtension(send, "sql.operation.get", reference, "token"),
    ).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
  it("permits SQL plans over the I/O 512 KiB ceiling with explicit transport bounds", async () => {
    class Socket extends EventEmitter {
      connected = true;
      io = { engine: { transport: { writable: true } } };
      volatile = { emit: vi.fn() };
    }
    const socket = new Socket();
    const transport = createSocketActionIoTransport({
      socket,
      agentId: "a",
      maxRequestBytes: 3 * 1024 * 1024,
      maxResponseBytes: 4 * 1024 * 1024,
    });
    const pending = transport({
      jsonrpc: "2.0",
      id: "q",
      method: "sql.operation.execute",
      params: { ...plan, padding: "x".repeat(600000) },
    });
    const checked = expect(pending).rejects.toMatchObject({
      details: { outcome_unknown: true },
    });
    expect(socket.volatile.emit).toHaveBeenCalledOnce();
    transport.dispose();
    await checked;
  });
});
