import type { IExecuteFunctions } from "n8n-workflow";

import { DEFAULT_API_VERSION } from "../contracts/api";
import type {
  BuiltCommandRequest,
  JsonObject,
  PlugResolvedExecutionContext,
  SqlBulkInsertColumn,
  SqlExecuteBatchCommandItem,
} from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { isRecord, parseOptionalJsonArray, parseOptionalJsonObject } from "../utils/json";
import { applyCommandDefaults } from "./plugCommandDefaults";
import {
  toCollection,
  toOptionalBoolean,
  toOptionalPositiveNumber,
  toOptionalString,
} from "./plugExecutionParameters";
import {
  assertBulkInsertWithinHubLimits,
  resolveAutoMaxParallelReadOnlyBatchItems,
} from "./plugSqlPerformanceHints";

const sqlTemplateMarkers = [
  "{{substitua_pela_tabela}}",
  "example_table",
  "sua_tabela",
  "TODO",
  "CHANGE_ME",
] as const;

const sqlNamedParameterPattern = /(?<!:):([A-Za-z_][A-Za-z0-9_]*)/g;

const stripSqlCommentsAndStrings = (sql: string): string =>
  sql
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const findTemplateMarker = (sql: string): string | undefined => {
  const normalizedSql = sql.toLowerCase();

  return sqlTemplateMarkers.find((marker) =>
    normalizedSql.includes(marker.toLowerCase()),
  );
};

const findNamedSqlParameters = (sql: string): string[] => {
  const cleanSql = stripSqlCommentsAndStrings(sql);
  const parameters = new Set<string>();

  for (const match of cleanSql.matchAll(sqlNamedParameterPattern)) {
    parameters.add(match[1]);
  }

  return [...parameters];
};

const validateNamedSqlParameters = (
  sql: string,
  params: JsonObject | undefined,
  fieldLabel: string,
): void => {
  const parameterNames = findNamedSqlParameters(sql);
  if (parameterNames.length === 0) {
    return;
  }

  const missingParameter = parameterNames.find(
    (parameterName) => !params || !(parameterName in params),
  );
  if (!missingParameter) {
    return;
  }

  throw new PlugValidationError(
    `${fieldLabel} uses :${missingParameter}, but Named Params JSON does not contain the key "${missingParameter}".`,
  );
};

const validateSafeMutationSql = (sql: string, fieldLabel: string): void => {
  const cleanStatements = stripSqlCommentsAndStrings(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

  const unsafeStatement = cleanStatements.find((statement) => {
    const normalizedStatement = statement.replace(/\s+/g, " ").toLowerCase();
    return (
      /(^|\s)(update|delete)\s/.test(normalizedStatement) &&
      !/(^|\s)where\s/.test(normalizedStatement)
    );
  });

  if (!unsafeStatement) {
    return;
  }

  throw new PlugValidationError(
    `${fieldLabel} contains UPDATE/DELETE without WHERE. Add a WHERE clause or turn off Require WHERE for UPDATE/DELETE in Additional Options.`,
  );
};

export const validateGuidedSql = (
  sql: string,
  params: JsonObject | undefined,
  options: {
    readonly fieldLabel: string;
    readonly requireWhereForUpdateDelete: boolean;
  },
): void => {
  const marker = findTemplateMarker(sql);
  if (marker) {
    throw new PlugValidationError(
      `${options.fieldLabel} still contains ${marker}; replace it before running the node.`,
    );
  }

  validateNamedSqlParameters(sql, params, options.fieldLabel);

  if (options.requireWhereForUpdateDelete) {
    validateSafeMutationSql(sql, options.fieldLabel);
  }
};

export const parseBulkInsertColumns = (value: unknown): SqlBulkInsertColumn[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PlugValidationError("Columns JSON must be a non-empty array");
  }

  return value.map((column, index) => {
    if (!isRecord(column)) {
      throw new PlugValidationError(`Column at index ${index} must be an object`);
    }

    const name = typeof column.name === "string" ? column.name.trim() : "";
    const type = typeof column.type === "string" ? column.type.trim() : "";
    if (name === "" || type === "") {
      throw new PlugValidationError(
        `Column at index ${index} must include non-empty name and type`,
      );
    }

    return {
      name,
      type,
      ...(typeof column.nullable === "boolean" ? { nullable: column.nullable } : {}),
      ...(typeof column.max_len === "number" && Number.isFinite(column.max_len)
        ? { max_len: column.max_len }
        : {}),
    };
  });
};

export const parseBulkInsertRows = (
  value: unknown,
  columnCount: number,
): readonly (readonly unknown[])[] => {
  if (!Array.isArray(value) || value.length === 0) {
    throw new PlugValidationError("Rows JSON must be a non-empty array");
  }

  return value.map((row, index) => {
    if (!Array.isArray(row)) {
      throw new PlugValidationError(`Row at index ${index} must be an array`);
    }

    if (row.length !== columnCount) {
      throw new PlugValidationError(
        `Row at index ${index} must have ${columnCount} value(s) to match Columns JSON`,
      );
    }

    return row;
  });
};

export const buildGuidedSqlCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
): BuiltCommandRequest => {
  const sql = context.getNodeParameter("sql", itemIndex) as string;
  const namedParamsJson = context.getNodeParameter(
    "namedParamsJson",
    itemIndex,
    "",
  ) as string;
  const options = toCollection(context, "sqlOptions", itemIndex);
  const params = parseOptionalJsonObject(namedParamsJson, "Named Params JSON");
  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const maxRows = toOptionalPositiveNumber(options.maxRows);
  const executionMode =
    options.executionMode === "managed" || options.executionMode === "preserve"
      ? options.executionMode
      : undefined;
  const multiResult = toOptionalBoolean(options.multiResult);
  const preferDbStreaming = toOptionalBoolean(options.preferDbStreaming);
  const page = toOptionalPositiveNumber(options.page);
  const pageSize = toOptionalPositiveNumber(options.pageSize);
  const cursor = toOptionalString(options.cursor);
  const database = toOptionalString(options.database);
  const idempotencyKey = toOptionalString(options.idempotencyKey);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");
  const requireWhereForUpdateDelete =
    toOptionalBoolean(options.requireWhereForUpdateDelete) ?? true;

  if (
    (page !== undefined && pageSize === undefined) ||
    (page === undefined && pageSize !== undefined)
  ) {
    throw new PlugValidationError("Page and Page Size must be used together");
  }

  if (cursor && (page !== undefined || pageSize !== undefined)) {
    throw new PlugValidationError("Cursor cannot be combined with Page or Page Size");
  }

  if (
    executionMode === "preserve" &&
    (page !== undefined || pageSize !== undefined || cursor)
  ) {
    throw new PlugValidationError(
      "Execution Mode Preserve cannot be combined with Page, Page Size, or Cursor",
    );
  }

  if (multiResult === true && params !== undefined) {
    throw new PlugValidationError(
      "Multi Result cannot be combined with Named Params JSON",
    );
  }

  validateGuidedSql(sql, params, {
    fieldLabel: "SQL",
    requireWhereForUpdateDelete,
  });

  const command = applyCommandDefaults(
    {
      method: "sql.execute",
      params: {
        sql,
        ...(params ? { params } : {}),
        ...(database ? { database } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        options: {
          ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
          ...(maxRows ? { max_rows: maxRows } : {}),
          ...(executionMode ? { execution_mode: executionMode } : {}),
          ...(multiResult !== undefined ? { multi_result: multiResult } : {}),
          ...(preferDbStreaming !== undefined
            ? { prefer_db_streaming: preferDbStreaming }
            : {}),
          ...(page ? { page } : {}),
          ...(pageSize ? { page_size: pageSize } : {}),
          ...(cursor ? { cursor } : {}),
        },
      },
    },
    executionContext,
    apiVersion,
    meta,
  );

  return {
    operation: "executeSql",
    agentId: executionContext.resolvedAgentId,
    channel: "rest",
    responseMode: "aggregatedJson",
    command,
    timeoutMs,
  };
};

export const mapGuidedBatchCommandItems = (
  commands: unknown[],
  requireWhereForUpdateDelete: boolean,
): SqlExecuteBatchCommandItem[] =>
  commands.map((item, index) => {
    if (!isRecord(item)) {
      throw new PlugValidationError(`Batch command at index ${index} must be an object`);
    }
    if (typeof item.sql !== "string" || item.sql.trim() === "") {
      throw new PlugValidationError(`Batch command at index ${index} must include sql`);
    }

    const params = isRecord(item.params) ? item.params : undefined;
    validateGuidedSql(item.sql, params, {
      fieldLabel: `Batch command at index ${index}`,
      requireWhereForUpdateDelete,
    });

    return {
      sql: item.sql,
      ...(params ? { params } : {}),
      ...(typeof item.execution_order === "number"
        ? { execution_order: item.execution_order }
        : {}),
    } as SqlExecuteBatchCommandItem;
  });

export const buildGuidedBatchCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
  commandsOverride?: SqlExecuteBatchCommandItem[],
): BuiltCommandRequest => {
  const options = toCollection(context, "batchOptions", itemIndex);
  const requireWhereForUpdateDelete =
    toOptionalBoolean(options.requireWhereForUpdateDelete) ?? true;

  const batchItems =
    commandsOverride ??
    (() => {
      const batchCommandsJson = context.getNodeParameter(
        "batchCommandsJson",
        itemIndex,
      ) as string;
      const commands = parseOptionalJsonArray(batchCommandsJson, "Batch Commands JSON");
      if (!commands || commands.length === 0) {
        throw new PlugValidationError(
          "Batch Commands JSON must contain at least one command",
        );
      }

      return mapGuidedBatchCommandItems(commands, requireWhereForUpdateDelete);
    })();

  if (batchItems.length === 0) {
    throw new PlugValidationError(
      "Batch Commands JSON must contain at least one command",
    );
  }

  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const maxRows = toOptionalPositiveNumber(options.maxRows);
  const transaction = toOptionalBoolean(options.transaction);
  const maxParallelReadOnlyBatchItems = toOptionalPositiveNumber(
    options.maxParallelReadOnlyBatchItems,
  );
  const maxParallelExplicit = "maxParallelReadOnlyBatchItems" in options;
  const autoPerformanceHints = toOptionalBoolean(options.autoPerformanceHints) ?? true;
  const resolvedMaxParallelReadOnlyBatchItems = maxParallelExplicit
    ? maxParallelReadOnlyBatchItems
    : resolveAutoMaxParallelReadOnlyBatchItems(
        batchItems,
        maxParallelReadOnlyBatchItems,
        autoPerformanceHints,
      );
  const database = toOptionalString(options.database);
  const idempotencyKey = toOptionalString(options.idempotencyKey);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

  const command = applyCommandDefaults(
    {
      method: "sql.executeBatch",
      params: {
        commands: batchItems,
        ...(database ? { database } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        options: {
          ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
          ...(maxRows ? { max_rows: maxRows } : {}),
          ...(transaction !== undefined ? { transaction } : {}),
          ...(resolvedMaxParallelReadOnlyBatchItems
            ? {
                max_parallel_read_only_batch_items: resolvedMaxParallelReadOnlyBatchItems,
              }
            : {}),
        },
      },
    },
    executionContext,
    apiVersion,
    meta,
  );

  return {
    operation: "executeBatch",
    agentId: executionContext.resolvedAgentId,
    channel: "rest",
    responseMode: "aggregatedJson",
    command,
    timeoutMs,
  };
};

export const buildGuidedBulkInsertCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
): BuiltCommandRequest => {
  const table = context.getNodeParameter("bulkInsertTable", itemIndex) as string;
  const columnsJson = context.getNodeParameter(
    "bulkInsertColumnsJson",
    itemIndex,
  ) as string;
  const rowsJson = context.getNodeParameter("bulkInsertRowsJson", itemIndex) as string;
  const options = toCollection(context, "bulkInsertOptions", itemIndex);
  const parsedColumns = parseOptionalJsonArray(columnsJson, "Columns JSON");
  if (!parsedColumns) {
    throw new PlugValidationError("Columns JSON is required");
  }
  const parsedRows = parseOptionalJsonArray(rowsJson, "Rows JSON");
  if (!parsedRows) {
    throw new PlugValidationError("Rows JSON is required");
  }
  const columns = parseBulkInsertColumns(parsedColumns);
  const rows = parseBulkInsertRows(parsedRows, columns.length);
  assertBulkInsertWithinHubLimits(table.trim(), columns, rows);
  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const database = toOptionalString(options.database);
  const idempotencyKey = toOptionalString(options.idempotencyKey);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

  if (table.trim() === "") {
    throw new PlugValidationError("Table is required for Bulk Insert SQL");
  }

  const command = applyCommandDefaults(
    {
      method: "sql.bulkInsert",
      params: {
        table: table.trim(),
        columns,
        rows,
        ...(database ? { database } : {}),
        ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
        options: {
          ...(timeoutMs ? { timeout_ms: timeoutMs } : {}),
        },
      },
    },
    executionContext,
    apiVersion,
    meta,
  );

  return {
    operation: "bulkInsertSql",
    agentId: executionContext.resolvedAgentId,
    channel: "rest",
    responseMode: "aggregatedJson",
    command,
    timeoutMs,
  };
};

export const buildGuidedCancelCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
): BuiltCommandRequest => {
  const executionId = toOptionalString(
    context.getNodeParameter("cancelExecutionId", itemIndex, ""),
  );
  const requestId = toOptionalString(
    context.getNodeParameter("cancelRequestId", itemIndex, ""),
  );
  if (!executionId && !requestId) {
    throw new PlugValidationError(
      "Execution ID or Request ID must be provided for Cancel SQL",
    );
  }

  const options = toCollection(context, "cancelOptions", itemIndex);
  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

  return {
    operation: "cancelSql",
    channel: "rest",
    responseMode: "aggregatedJson",
    command: applyCommandDefaults(
      {
        method: "sql.cancel",
        params: {
          ...(executionId ? { execution_id: executionId } : {}),
          ...(requestId ? { request_id: requestId } : {}),
        },
      },
      executionContext,
      apiVersion,
      meta,
    ),
    agentId: executionContext.resolvedAgentId,
    timeoutMs,
  };
};
