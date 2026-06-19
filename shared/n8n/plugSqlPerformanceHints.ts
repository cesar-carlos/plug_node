import type { SqlExecuteBatchCommandItem } from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";

export const plugBulkInsertMaxRows = 50_000;
export const plugBulkInsertMaxJsonBytes = 10 * 1024 * 1024;
export const plugLargeResultTopThreshold = 1_000;
export const plugMaxParallelReadOnlyBatchItems = 8;

const mutationKeywordPattern = /(^|\s)(insert|update|delete|merge|exec|execute)\s/i;

const stripSqlCommentsAndStrings = (sql: string): string =>
  sql
    .replace(/'([^']|'')*'/g, "''")
    .replace(/"([^"]|"")*"/g, '""')
    .replace(/--.*$/gm, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");

const splitSqlStatements = (sql: string): string[] =>
  stripSqlCommentsAndStrings(sql)
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement !== "");

export const isLikelyReadOnlySql = (sql: string): boolean => {
  const statements = splitSqlStatements(sql);
  if (statements.length !== 1) {
    return false;
  }

  const normalizedStatement = statements[0].replace(/\s+/g, " ");
  if (!/^\s*select\b/i.test(normalizedStatement)) {
    return false;
  }

  return !mutationKeywordPattern.test(normalizedStatement);
};

export const shouldAutoPreferDbStreaming = (sql: string): boolean => {
  if (!isLikelyReadOnlySql(sql)) {
    return false;
  }

  const cleanSql = splitSqlStatements(sql)[0].replace(/\s+/g, " ");
  const topMatch = /^\s*select\s+top\s+(?:\((\d+)\)|(\d+))/i.exec(cleanSql);
  if (topMatch) {
    const topN = Number(topMatch[1] ?? topMatch[2]);
    return Number.isFinite(topN) && topN >= plugLargeResultTopThreshold;
  }

  return /\bfrom\b/i.test(cleanSql);
};

export const resolveAutoMaxParallelReadOnlyBatchItems = (
  commands: readonly Pick<SqlExecuteBatchCommandItem, "sql">[],
  explicitValue: number | undefined,
  hintsEnabled: boolean,
): number | undefined => {
  if (explicitValue !== undefined && explicitValue > 0) {
    return explicitValue;
  }

  if (!hintsEnabled || commands.length === 0) {
    return undefined;
  }

  if (!commands.every((command) => isLikelyReadOnlySql(command.sql))) {
    return undefined;
  }

  return Math.min(commands.length, plugMaxParallelReadOnlyBatchItems);
};

const estimateBulkInsertJsonBytes = (
  table: string,
  columns: readonly { readonly name: string; readonly type: string }[],
  rows: readonly (readonly unknown[])[],
): number => new TextEncoder().encode(JSON.stringify({ table, columns, rows })).length;

export const assertBulkInsertWithinHubLimits = (
  table: string,
  columns: readonly { readonly name: string; readonly type: string }[],
  rows: readonly (readonly unknown[])[],
): void => {
  if (rows.length > plugBulkInsertMaxRows) {
    throw new PlugValidationError(
      `Bulk Insert rows (${rows.length.toLocaleString()}) exceed the hub limit of ${plugBulkInsertMaxRows.toLocaleString()}. Split into batches of at most ${plugBulkInsertMaxRows.toLocaleString()} rows.`,
    );
  }

  const serializedBytes = estimateBulkInsertJsonBytes(table, columns, rows);
  if (serializedBytes > plugBulkInsertMaxJsonBytes) {
    const maxMiB = Math.round(plugBulkInsertMaxJsonBytes / (1024 * 1024));
    throw new PlugValidationError(
      `Bulk Insert payload (${serializedBytes.toLocaleString()} bytes) exceeds the hub limit of ~${maxMiB} MiB. Split rows into smaller batches.`,
    );
  }
};
