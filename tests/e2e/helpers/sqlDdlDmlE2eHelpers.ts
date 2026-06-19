import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

import { expect } from "vitest";
import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import type { PlugServerTimings } from "../../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";
import { PlugDatabase as PublicPlugDatabase } from "../../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
import type { PlugE2EConfig } from "./e2eEnv";
import { executeOrSkipInfrastructure, type SkipFunction } from "./executeOrSkip";
import { createLiveExecuteContext } from "./liveExecuteContext";
import {
  baseParameters,
  credentialsForChannel,
  maybeSkipInfrastructureResponse,
  type SqlLiveChannel,
} from "./sqlE2eChannel";
import { expectStructuredErrorResponse } from "./sqlE2eAssertions";

export interface SqlDdlDmlStepResult {
  readonly output: Record<string, unknown>;
  readonly elapsedMs: number;
}

export interface SqlDdlDmlExecuteSqlOptions {
  readonly channel: SqlLiveChannel;
  readonly e2eConfig: PlugE2EConfig;
  readonly sql: string;
  readonly skip: SkipFunction;
  readonly stepLabel: string;
  readonly requireWhereForUpdateDelete?: boolean;
  readonly executionMode?: "managed" | "preserve";
  readonly responseMode?: "rawJsonRpc" | "aggregatedJson";
}

export interface SqlDdlDmlExecuteBatchOptions {
  readonly channel: SqlLiveChannel;
  readonly e2eConfig: PlugE2EConfig;
  readonly commands: readonly { readonly sql: string }[];
  readonly skip: SkipFunction;
  readonly stepLabel: string;
  readonly transaction?: boolean;
  readonly expectFailure?: boolean;
}

const node = new PublicPlugDatabase();

export const createUniqueTableName = (): string => {
  const suffix = `${Date.now()}_${randomBytes(4).toString("hex")}`;
  return `PlugE2E_DdlDml_${suffix}`;
};

export const qualifiedTableName = (tableName: string): string => `dbo.${tableName}`;

export const buildCreateTableSql = (tableName: string): string =>
  `CREATE TABLE ${qualifiedTableName(tableName)} (Id INT NOT NULL PRIMARY KEY, Name NVARCHAR(100) NOT NULL, Amount DECIMAL(18, 2) NOT NULL, CreatedAt DATETIME NOT NULL)`;

export const buildDropTableSql = (tableName: string): string =>
  `DROP TABLE IF EXISTS ${qualifiedTableName(tableName)}`;

export const ddlStressRowIdStart = 1_000;

export const buildStressInsertValueRows = (startId: number, count: number): string => {
  const values: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = startId + index;
    values.push(`(${id}, N'Stress_${id}', ${(id % 100) + 0.5}, GETDATE())`);
  }
  return values.join(", ");
};

export const buildStressInsertCommands = (
  table: string,
  totalRows: number,
  batchSize: number,
  startId: number = ddlStressRowIdStart,
): readonly { readonly sql: string }[] => {
  const commands: { sql: string }[] = [];
  for (let offset = 0; offset < totalRows; offset += batchSize) {
    const chunkSize = Math.min(batchSize, totalRows - offset);
    commands.push({
      sql: `INSERT INTO ${table} (Id, Name, Amount, CreatedAt) VALUES ${buildStressInsertValueRows(startId + offset, chunkSize)}`,
    });
  }
  return commands;
};

export const buildStressBulkUpdateSql = (
  table: string,
  totalRows: number,
  startId: number = ddlStressRowIdStart,
): string =>
  `UPDATE ${table} SET Amount = Amount + 0.01 WHERE Id >= ${startId} AND Id < ${startId + totalRows}`;

export const buildDeleteAllRowsSql = (table: string): string =>
  `DELETE FROM ${table} WHERE Id > 0`;

export const extractScalarFromRows = (
  rows: readonly Record<string, unknown>[],
  column: string,
): number => {
  expect(rows.length).toBeGreaterThan(0);
  const row = rows[0] ?? {};
  const raw =
    row[column] ??
    row[column.toLowerCase()] ??
    row[column.toUpperCase()] ??
    Object.values(row)[0];
  return Number(raw);
};

export const reportStressMetrics = (
  stepLabel: string,
  elapsedMs: number,
  rowCount: number,
  output?: Record<string, unknown>,
): void => {
  const rowsPerSec = rowCount > 0 && elapsedMs > 0 ? (rowCount / elapsedMs) * 1_000 : 0;
  const serverTimings = output ? readServerTimings(output) : undefined;
  const phases = serverTimings
    ? Object.entries(serverTimings.phasesMs)
        .map(([phase, durationMs]) => `${phase}=${durationMs}ms`)
        .join(", ")
    : "n/a";

  console.info(
    `[DDL/DML stress] ${stepLabel}: ${elapsedMs.toFixed(0)}ms, ${rowCount} rows, ${rowsPerSec.toFixed(1)} rows/s, server phases: ${phases}`,
  );
};

const socketTimingParameters = (channel: SqlLiveChannel): Record<string, unknown> =>
  channel === "socket"
    ? {
        socketOptions: {
          requestServerTimings: true,
        },
      }
    : {};

const readRpcResponse = (
  output: Record<string, unknown>,
): {
  readonly success: boolean;
  readonly result?: Record<string, unknown>;
  readonly error?: Record<string, unknown>;
} => {
  const response = output.response as {
    type?: string;
    item?: {
      success?: boolean;
      result?: Record<string, unknown>;
      error?: Record<string, unknown>;
    };
  };

  expect(response.type).toBe("single");
  expect(response.item).toBeDefined();

  return {
    success: response.item?.success === true,
    ...(response.item?.result ? { result: response.item.result } : {}),
    ...(response.item?.error ? { error: response.item.error } : {}),
  };
};

export const extractSelectRows = (
  output: Record<string, unknown>,
): readonly Record<string, unknown>[] => {
  if (Array.isArray(output.rows)) {
    return output.rows as readonly Record<string, unknown>[];
  }

  const rpc = readRpcResponse(output);
  expect(rpc.success).toBe(true);
  expect(rpc.result).toBeDefined();

  const rows = rpc.result?.rows;
  expect(Array.isArray(rows)).toBe(true);
  return rows as readonly Record<string, unknown>[];
};

export const readServerTimings = (
  output: Record<string, unknown>,
): PlugServerTimings | undefined => {
  const plug = output.__plug as
    | {
        transport?: {
          serverTimings?: PlugServerTimings;
        };
      }
    | undefined;

  return plug?.transport?.serverTimings;
};

export const assertStepTiming = (
  stepLabel: string,
  elapsedMs: number,
  stepMaxMs: number,
  output?: Record<string, unknown>,
): void => {
  expect(
    elapsedMs,
    `${stepLabel} exceeded client step limit (${stepMaxMs}ms, took ${elapsedMs.toFixed(0)}ms)`,
  ).toBeLessThan(stepMaxMs);

  if (!output) {
    return;
  }

  const serverTimings = readServerTimings(output);
  if (!serverTimings) {
    return;
  }

  expect(serverTimings.schemaVersion).toBeGreaterThanOrEqual(1);
  expect(Object.keys(serverTimings.phasesMs).length).toBeGreaterThan(0);

  const phaseTotalMs = Object.values(serverTimings.phasesMs).reduce(
    (sum, value) => sum + value,
    0,
  );
  expect(
    phaseTotalMs,
    `${stepLabel} server phase timings exceeded step limit`,
  ).toBeLessThan(stepMaxMs);
};

export const maybeSkipDdlDenied = (
  output: Record<string, unknown>,
  skip: SkipFunction,
): void => {
  const response = output.response as {
    item?: {
      success?: boolean;
      error?: {
        code?: number;
        message?: string;
        data?: {
          reason?: string;
          category?: string;
        };
      };
    };
  };

  if (response.item?.success !== false) {
    return;
  }

  const error = response.item.error;
  const reason = error?.data?.reason;
  const message = error?.message ?? "";

  if (
    error?.code === -32002 ||
    reason === "unauthorized" ||
    reason === "sql_validation_failed" ||
    message.includes("DDL") ||
    message.includes("CREATE TABLE")
  ) {
    skip(
      "Client token does not allow DDL/DML lifecycle probes. Set PLUG_E2E_DDL_ENABLED=1 only when the token permits CREATE/DROP/INSERT/UPDATE/DELETE on a staging table.",
    );
  }
};

const runNode = async (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
  parameters: Record<string, unknown>,
  skip: SkipFunction,
): Promise<INodeExecutionData[][]> => {
  const context: IExecuteFunctions = createLiveExecuteContext({
    credentials: credentialsForChannel(e2eConfig, channel),
    requestTimeoutMs: e2eConfig.timeoutMs,
    parameters: baseParameters(channel, parameters),
  });

  return executeOrSkipInfrastructure(node, context, skip);
};

export const executeSqlStep = async (
  options: SqlDdlDmlExecuteSqlOptions,
): Promise<SqlDdlDmlStepResult> => {
  const startedAt = performance.now();
  const result = await runNode(
    options.channel,
    options.e2eConfig,
    {
      operation: "executeSql",
      inputMode: "guided",
      responseMode: options.responseMode ?? "rawJsonRpc",
      sql: options.sql,
      sqlOptions: {
        timeoutMs: options.e2eConfig.timeoutMs,
        executionMode: options.executionMode ?? "preserve",
        maxRows: 100,
        ...(options.requireWhereForUpdateDelete === false
          ? { requireWhereForUpdateDelete: false }
          : {}),
      },
      ...socketTimingParameters(options.channel),
    },
    options.skip,
  );

  const elapsedMs = performance.now() - startedAt;

  if ((options.responseMode ?? "rawJsonRpc") === "aggregatedJson") {
    const firstItem = result[0][0]?.json as Record<string, unknown> | undefined;
    if (firstItem?.response) {
      maybeSkipInfrastructureResponse(firstItem.response, options.skip);
      maybeSkipDdlDenied(firstItem, options.skip);
    }

    if (firstItem?.__plug && (firstItem as { rowCount?: number }).rowCount === 0) {
      return { output: { rows: [] }, elapsedMs };
    }

    const rows = result[0].map((item) => {
      const json = { ...(item.json as Record<string, unknown>) };
      delete json.__plug;
      return json;
    });
    return { output: { rows }, elapsedMs };
  }

  const output = result[0][0].json as Record<string, unknown>;
  maybeSkipInfrastructureResponse(output.response, options.skip);
  maybeSkipDdlDenied(output, options.skip);

  const rpc = readRpcResponse(output);
  if (!rpc.success) {
    maybeSkipDdlDenied(output, options.skip);
    const errorDetail = JSON.stringify(rpc.error ?? output.response);
    expect(rpc.success, `${options.stepLabel} failed: ${errorDetail}`).toBe(true);
  }

  return { output, elapsedMs };
};

export const executeBatchStep = async (
  options: SqlDdlDmlExecuteBatchOptions,
): Promise<SqlDdlDmlStepResult> => {
  const startedAt = performance.now();
  const result = await runNode(
    options.channel,
    options.e2eConfig,
    {
      operation: "executeBatch",
      inputMode: "guided",
      responseMode: "rawJsonRpc",
      batchCommandsJson: JSON.stringify(options.commands),
      batchOptions: {
        timeoutMs: options.e2eConfig.timeoutMs,
        ...(options.transaction === true ? { transaction: true } : {}),
      },
      ...socketTimingParameters(options.channel),
    },
    options.skip,
  );

  const elapsedMs = performance.now() - startedAt;
  const output = result[0][0].json as Record<string, unknown>;
  maybeSkipInfrastructureResponse(output.response, options.skip);
  maybeSkipDdlDenied(output, options.skip);

  if (options.expectFailure) {
    expectStructuredErrorResponse(output);
  } else {
    const rpc = readRpcResponse(output);
    expect(rpc.success, `${options.stepLabel} failed`).toBe(true);
  }

  return { output, elapsedMs };
};

export const readRowId = (row: Record<string, unknown>): number => {
  const raw = row.Id ?? row.id ?? row.ID;
  return Number(raw);
};

export const readRowName = (row: Record<string, unknown>): string =>
  String(row.Name ?? row.name ?? row.NAME ?? "");

export const extractRowsFromBatchOutput = (
  output: Record<string, unknown>,
  commandIndex: number,
): readonly Record<string, unknown>[] => {
  const rpc = readRpcResponse(output);
  expect(rpc.success).toBe(true);

  const result = rpc.result as
    | {
        readonly commands?: Array<{
          readonly result?: { readonly rows?: unknown };
          readonly rows?: unknown;
        }>;
        readonly items?: Array<{
          readonly result?: { readonly rows?: unknown };
          readonly rows?: unknown;
        }>;
      }
    | undefined;

  const entries = result?.commands ?? result?.items;
  expect(Array.isArray(entries)).toBe(true);
  expect(entries?.length).toBeGreaterThan(commandIndex);

  const entry = entries?.[commandIndex];
  const rows = entry?.result?.rows ?? entry?.rows;
  expect(Array.isArray(rows)).toBe(true);
  return rows as readonly Record<string, unknown>[];
};

export const dropTableBestEffort = async (
  channel: SqlLiveChannel,
  e2eConfig: PlugE2EConfig,
  tableName: string | undefined,
): Promise<void> => {
  if (!tableName) {
    return;
  }

  const context = createLiveExecuteContext({
    credentials: credentialsForChannel(e2eConfig, channel),
    requestTimeoutMs: e2eConfig.timeoutMs,
    parameters: baseParameters(channel, {
      operation: "executeBatch",
      inputMode: "guided",
      responseMode: "rawJsonRpc",
      batchCommandsJson: JSON.stringify([{ sql: buildDropTableSql(tableName) }]),
      batchOptions: {
        timeoutMs: e2eConfig.timeoutMs,
      },
    }),
  });

  try {
    await node.execute.call(context);
  } catch {
    // Best-effort cleanup only.
  }
};
