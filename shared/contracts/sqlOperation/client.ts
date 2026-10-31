import { randomUUID } from "node:crypto";
import { z } from "zod4";
import {
  ActionIoError,
  dispatchEncodedCommand,
  type ActionIoTransport,
} from "../actionIo/client";
import { actionIoErrorDetails } from "../actionIo/errorDetails";
import {
  sqlOperationExecuteParamsSchema,
  sqlOperationReferenceParamsSchema,
} from "./params";
import { sourceDiscoveryParamsSchema, sourceDiscoveryResultSchema } from "./source";
import { sourceSchemaParamsSchema, sourceSchemaResultSchema } from "./schema";
import { isRecord } from "../../utils/json";

const resultSchema = z
  .strictObject({
    operationId: z.uuid(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    executionId: z.string(),
    state: z.enum([
      "executando",
      "cancelamento_solicitado",
      "concluida",
      "rollback_confirmado",
      "resultado_desconhecido",
      "cancelada",
    ]),
    directlyAffectedRows: z.number().int().min(0).nullable(),
    updatedAt: z.iso.datetime({ offset: true }),
    completedAt: z.iso.datetime({ offset: true }).nullable().optional(),
    failureCode: z
      .enum([
        "SOURCE_IDENTITY_MISMATCH",
        "SOURCE_STRUCTURE_MISMATCH",
        "SQL_OPERATION_CONDITION_FAILED",
        "SQL_OPERATION_ROW_LIMIT",
        "SQL_OPERATION_ROW_COUNT_UNKNOWN",
        "SQL_OPERATION_OUTPUT_INVALID",
        "SQL_OPERATION_AUTHORIZATION_CHANGED",
        "SQL_OPERATION_AUTHORIZATION_DENIED",
        "SQL_OPERATION_CANCELLED",
        "SQL_OPERATION_NATIVE_FAILED",
        "SQL_OPERATION_TIMEOUT",
        "SQL_OPERATION_INTERRUPTED",
        "SQL_OPERATION_FAILED",
      ])
      .optional(),
  })
  .refine(
    (v) =>
      !v.failureCode ||
      ["cancelada", "rollback_confirmado", "resultado_desconhecido"].includes(v.state),
  );
const methods: Record<string, { params: z.ZodType; result: z.ZodType }> = {
  "agent.getHealth": {
    params: z.strictObject({ client_token: z.string().min(1).max(65536) }),
    result: z
      .object({
        status: z.enum(["healthy", "degraded"]),
        timestamp: z.iso.datetime({ offset: true }),
        version: z.string(),
        pool: z.object({ size: z.number().int().min(0) }).passthrough(),
        sql_queue: z.object({ enabled: z.boolean() }).passthrough(),
        queries: z
          .object({
            total: z.number().int().min(0),
            errors: z.number().int().min(0),
            success_rate: z.number(),
            avg_latency_ms: z.number(),
            p95_latency_ms: z.number(),
            p99_latency_ms: z.number(),
          })
          .passthrough(),
        uptime_seconds: z.number().int().min(0),
      })
      .passthrough(),
  },
  "sql.operation.execute": {
    params: sqlOperationExecuteParamsSchema,
    result: resultSchema,
  },
  "sql.operation.get": {
    params: sqlOperationReferenceParamsSchema,
    result: resultSchema,
  },
  "sql.operation.cancel": {
    params: sqlOperationReferenceParamsSchema,
    result: resultSchema,
  },
  "sql.describeSource": {
    params: sourceDiscoveryParamsSchema,
    result: sourceDiscoveryResultSchema,
  },
  "sql.describeSchema": {
    params: sourceSchemaParamsSchema,
    result: sourceSchemaResultSchema,
  },
};

/** Hub dispatch performs current authenticated capability negotiation. No fallback. */
export const callSqlExtension = async (
  transport: ActionIoTransport,
  method: string,
  input: Record<string, unknown>,
  token: string,
): Promise<Record<string, unknown>> => {
  if (!Object.prototype.hasOwnProperty.call(methods, method))
    throw new ActionIoError("INVALID_REQUEST", false);
  const contract = methods[method];
  if (typeof input.database === "string" && input.database !== input.database.trim())
    throw new ActionIoError("NON_CANONICAL_IDENTITY", false);
  if (
    !contract ||
    !token ||
    ["client_token", "clientToken", "auth"].some((key) => key in input)
  )
    throw new ActionIoError("INVALID_REQUEST", false);
  const params: Record<string, unknown> = { ...input, client_token: token };
  const paramsJson = JSON.stringify(params);
  const paramsBytes = Buffer.byteLength(paramsJson);
  if (paramsBytes > 2097152 || !contract.params.safeParse(params).success)
    throw new ActionIoError("INVALID_REQUEST", false);
  if (
    method === "sql.describeSchema" &&
    Number(params.offset) >= (params.resources as unknown[]).length
  )
    throw new ActionIoError("INVALID_REQUEST", false);
  const command = { jsonrpc: "2.0" as const, id: randomUUID(), method, params };
  const mutation =
    method === "sql.operation.execute" || method === "sql.operation.cancel";
  let response: unknown;
  try {
    // The UUID and registered RPC method are ASCII. Socket limits the complete
    // command, while the SQL contract limits only its credential-bearing params.
    const prefix = `{"jsonrpc":"2.0","id":"${command.id}","method":"${method}","params":`;
    response = await dispatchEncodedCommand(
      transport,
      command,
      prefix + paramsJson + "}",
      prefix.length + paramsBytes + 1,
    );
  } catch (error) {
    if (error instanceof ActionIoError) throw error;
    throw new ActionIoError("TRANSPORT_UNCONFIRMED", mutation);
  }
  if (
    !isRecord(response) ||
    response.id !== command.id ||
    response.jsonrpc !== "2.0" ||
    "result" in response === "error" in response
  )
    throw new ActionIoError("INVALID_RESPONSE", mutation);
  if (isRecord(response.error)) {
    if (
      typeof response.error.code !== "number" ||
      typeof response.error.message !== "string" ||
      (response.error.data !== undefined && !isRecord(response.error.data))
    )
      throw new ActionIoError("INVALID_RESPONSE", mutation);
    const details = actionIoErrorDetails(response.error.data);
    throw new ActionIoError(
      String(details.code ?? details.failure_code ?? `RPC_${response.error.code}`),
      details.effects_possible === true ||
        details.outcome_unknown === true ||
        (mutation && details.effects_possible !== false),
      { ...details, rpc_code: response.error.code },
    );
  }
  const result = response.result;
  if (!isRecord(result) || !contract.result.safeParse(result).success)
    throw new ActionIoError("INVALID_RESPONSE", mutation);
  if (
    method.startsWith("sql.operation.") &&
    (result.operationId !== params.operationId ||
      result.fingerprint !== params.fingerprint)
  )
    throw new ActionIoError("RESULT_IDENTITY_MISMATCH", mutation);
  if (method === "sql.describeSource" && result.database !== params.database)
    throw new ActionIoError("RESULT_IDENTITY_MISMATCH", false);
  if (method === "sql.describeSchema") {
    const identity = result.identity as Record<string, unknown>;
    const expected = params.expectedSource as Record<string, unknown>;
    const page = result.metadataPage as Record<string, unknown>;
    const requested = (params.resources as unknown[]).slice(
      Number(params.offset),
      Number(params.offset) + Number(params.pageSize),
    );
    const resources = result.resources as Record<string, unknown>[];
    if (
      identity.database !== params.database ||
      identity.identityHash !== expected.identityHash ||
      identity.dialect !== expected.dialect ||
      page.offset !== params.offset ||
      page.pageSize !== params.pageSize ||
      page.nextOffset !==
        (Number(params.offset) + requested.length < (params.resources as unknown[]).length
          ? Number(params.offset) + requested.length
          : null) ||
      resources.length !== requested.length ||
      resources.some(
        (r, i) =>
          !isRecord(r.resource) ||
          !isRecord(requested[i]) ||
          ["schema", "name", "type"].some(
            (key) =>
              (r.resource as Record<string, unknown>)[key] !==
              (requested[i] as Record<string, unknown>)[key],
          ),
      )
    )
      throw new ActionIoError("RESULT_IDENTITY_MISMATCH", false);
  }
  return result;
};
