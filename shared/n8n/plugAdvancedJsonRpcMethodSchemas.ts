import { z } from "zod";

const nonEmptyString = z.string().trim().min(1);
const jsonObjectSchema = z.record(z.string(), z.unknown());
const rpcMetaSchema = jsonObjectSchema;

const rpcCommandEnvelopeSchema = z.object({
  jsonrpc: z.literal("2.0").optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
  api_version: nonEmptyString.optional(),
  meta: rpcMetaSchema.optional(),
});

const clientTokenCarrierFields = {
  client_token: nonEmptyString.optional(),
  clientToken: nonEmptyString.optional(),
  auth: nonEmptyString.optional(),
} as const;

export const clientTokenCarrierParamsSchema = z.object(clientTokenCarrierFields).strict();

const sqlExecuteOptionsSchema = z
  .object({
    timeout_ms: z.number().positive().optional(),
    max_rows: z.number().positive().optional(),
    page: z.number().int().positive().optional(),
    page_size: z.number().int().positive().optional(),
    cursor: nonEmptyString.optional(),
    execution_mode: z.enum(["managed", "preserve"]).optional(),
    preserve_sql: z.boolean().optional(),
    multi_result: z.boolean().optional(),
    prefer_db_streaming: z.boolean().optional(),
  })
  .strict();

const validateSqlExecuteOptions = (
  options: z.infer<typeof sqlExecuteOptionsSchema> | undefined,
  ctx: z.RefinementCtx,
  pathPrefix: (string | number)[],
): void => {
  if (!options) {
    return;
  }

  const hasPage = options.page !== undefined;
  const hasPageSize = options.page_size !== undefined;
  if (hasPage !== hasPageSize) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "page and page_size must be used together",
      path: [...pathPrefix, hasPage ? "page_size" : "page"],
    });
  }

  if (options.cursor && (hasPage || hasPageSize)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "cursor cannot be combined with page or page_size",
      path: [...pathPrefix, "cursor"],
    });
  }

  if (
    options.execution_mode === "preserve" &&
    (hasPage || hasPageSize || options.cursor)
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        "execution_mode preserve cannot be combined with page, page_size, or cursor",
      path: [...pathPrefix, "execution_mode"],
    });
  }
};

export const sqlExecuteParamsSchema = z
  .object({
    sql: nonEmptyString,
    params: jsonObjectSchema.optional(),
    ...clientTokenCarrierFields,
    idempotency_key: nonEmptyString.optional(),
    database: nonEmptyString.optional(),
    options: sqlExecuteOptionsSchema.optional(),
  })
  .strict()
  .superRefine((params, ctx) => {
    if (params.options?.multi_result === true && params.params !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "multi_result cannot be combined with params",
        path: ["options", "multi_result"],
      });
    }

    validateSqlExecuteOptions(params.options, ctx, ["options"]);
  });

const sqlExecuteBatchCommandItemSchema = z
  .object({
    sql: nonEmptyString,
    params: jsonObjectSchema.optional(),
    execution_order: z.number().int().optional(),
  })
  .strict();

const sqlExecuteBatchOptionsSchema = z
  .object({
    timeout_ms: z.number().positive().optional(),
    max_rows: z.number().positive().optional(),
    transaction: z.boolean().optional(),
    max_parallel_read_only_batch_items: z.number().positive().optional(),
  })
  .strict();

export const sqlExecuteBatchParamsSchema = z
  .object({
    commands: z.array(sqlExecuteBatchCommandItemSchema).min(1),
    ...clientTokenCarrierFields,
    idempotency_key: nonEmptyString.optional(),
    database: nonEmptyString.optional(),
    options: sqlExecuteBatchOptionsSchema.optional(),
  })
  .strict();

const sqlBulkInsertColumnSchema = z
  .object({
    name: nonEmptyString,
    type: nonEmptyString,
    nullable: z.boolean().optional(),
    max_len: z.number().finite().optional(),
  })
  .strict();

const sqlBulkInsertOptionsSchema = z
  .object({
    timeout_ms: z.number().positive().optional(),
  })
  .strict();

export const sqlBulkInsertParamsSchema = z
  .object({
    table: nonEmptyString,
    columns: z.array(sqlBulkInsertColumnSchema).min(1),
    rows: z.array(z.array(z.unknown())).min(1),
    ...clientTokenCarrierFields,
    idempotency_key: nonEmptyString.optional(),
    database: nonEmptyString.optional(),
    options: sqlBulkInsertOptionsSchema.optional(),
  })
  .strict()
  .superRefine((params, ctx) => {
    const columnCount = params.columns.length;
    params.rows.forEach((row, index) => {
      if (row.length !== columnCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `row at index ${index} must have ${columnCount} value(s) to match columns`,
          path: ["rows", index],
        });
      }
    });
  });

export const sqlCancelParamsSchema = z
  .object({
    execution_id: nonEmptyString.optional(),
    request_id: nonEmptyString.optional(),
  })
  .strict()
  .refine(
    (params) => params.execution_id !== undefined || params.request_id !== undefined,
    {
      message: "params must include execution_id and/or request_id",
    },
  );

export const rpcDiscoverParamsSchema = jsonObjectSchema;

export const advancedJsonRpcCommandSchema = z.discriminatedUnion("method", [
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("sql.execute"),
      params: sqlExecuteParamsSchema,
    })
    .strict(),
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("sql.executeBatch"),
      params: sqlExecuteBatchParamsSchema,
    })
    .strict(),
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("sql.bulkInsert"),
      params: sqlBulkInsertParamsSchema,
    })
    .strict(),
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("sql.cancel"),
      params: sqlCancelParamsSchema,
    })
    .strict(),
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("rpc.discover"),
      params: rpcDiscoverParamsSchema.optional(),
    })
    .strict(),
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("agent.getProfile"),
      params: clientTokenCarrierParamsSchema.optional(),
    })
    .strict(),
  rpcCommandEnvelopeSchema
    .extend({
      method: z.literal("client_token.getPolicy"),
      params: clientTokenCarrierParamsSchema.optional(),
    })
    .strict(),
]);
