import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { parseOptionalJsonArray, parseOptionalJsonObject } from "../utils/json";
import { toCollection, toOptionalBoolean, toOptionalPositiveNumber } from "./plugExecutionParameters";
import {
  isLikelyReadOnlySql,
  plugMaxParallelReadOnlyBatchItems,
} from "./plugSqlPerformanceHints";

/** Default ceiling when Auto Performance Hints enable input-item parallelism. */
export const plugMaxParallelInputItems = 4;

/**
 * Hub REST per-agent inflight ceiling (`SOCKET_REST_AGENT_MAX_INFLIGHT` in plug_server).
 * Caps node-side concurrency so independent items do not overload the agent bridge.
 */
export const socketRestAgentMaxInflight = 4;

const readParallelInputItemsCeiling = (): number => {
  const envValue = process.env.PLUG_MAX_PARALLEL_INPUT_ITEMS;
  if (envValue === undefined || envValue === "") {
    return plugMaxParallelInputItems;
  }

  const parsed = Number(envValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return plugMaxParallelInputItems;
  }

  return Math.trunc(parsed);
};

const capInputItemConcurrency = (value: number, itemCount: number): number =>
  Math.max(
    1,
    Math.min(
      Math.trunc(value),
      itemCount,
      readParallelInputItemsCeiling(),
      socketRestAgentMaxInflight,
      plugMaxParallelReadOnlyBatchItems,
    ),
  );

export const resolveMaxParallelInputItems = (
  allowParallel: boolean,
  explicitValue: number | undefined,
  hintsEnabled: boolean,
  itemCount: number,
): number => {
  if (!allowParallel || itemCount <= 1) {
    return 1;
  }

  if (explicitValue !== undefined && explicitValue > 0) {
    return capInputItemConcurrency(explicitValue, itemCount);
  }

  if (!hintsEnabled) {
    return 1;
  }

  return capInputItemConcurrency(readParallelInputItemsCeiling(), itemCount);
};

const sqlOptionsCollectionForOperation = (operation: string): string | undefined => {
  switch (operation) {
    case "executeSql":
      return "sqlOptions";
    case "executeBatch":
      return "batchOptions";
    case "bulkInsertSql":
      return "bulkInsertOptions";
    case "cancelSql":
      return "cancelOptions";
    case "discoverRpc":
      return "discoverOptions";
    case "validateContext":
      return "validateContextOptions";
    case "getAgentProfile":
    case "getClientTokenPolicy":
      return "profileOptions";
    default:
      return undefined;
  }
};

const isGuidedExecuteSqlItemReadOnly = (
  context: IExecuteFunctions,
  itemIndex: number,
): boolean => {
  const sql = context.getNodeParameter("sql", itemIndex) as string;
  return typeof sql === "string" && isLikelyReadOnlySql(sql);
};

const isGuidedExecuteBatchItemReadOnly = (
  context: IExecuteFunctions,
  itemIndex: number,
): boolean => {
  const options = toCollection(context, "batchOptions", itemIndex);
  if (toOptionalBoolean(options.transaction) === true) {
    return false;
  }

  const batchCommandsJson = context.getNodeParameter(
    "batchCommandsJson",
    itemIndex,
  ) as string;
  const commands = parseOptionalJsonArray(batchCommandsJson, "Batch Commands JSON");
  if (!commands || commands.length === 0) {
    return false;
  }

  return commands.every(
    (command) =>
      typeof command === "object" &&
      command !== null &&
      "sql" in command &&
      typeof command.sql === "string" &&
      isLikelyReadOnlySql(command.sql),
  );
};

const isAdvancedSqlItemReadOnly = (
  context: IExecuteFunctions,
  itemIndex: number,
  operation: "executeSql" | "executeBatch",
): boolean => {
  const advancedCommandJson = context.getNodeParameter(
    "advancedCommandJson",
    itemIndex,
  ) as string;
  const parsed = parseOptionalJsonObject(advancedCommandJson, "Raw JSON-RPC Command");
  if (!parsed) {
    return false;
  }

  if (operation === "executeSql") {
    const params = parsed.params;
    const sql =
      typeof params === "object" && params !== null && "sql" in params
        ? params.sql
        : undefined;
    return typeof sql === "string" && isLikelyReadOnlySql(sql);
  }

  const params = parsed.params;
  const commands =
    typeof params === "object" && params !== null && "commands" in params
      ? params.commands
      : undefined;
  if (!Array.isArray(commands) || commands.length === 0) {
    return false;
  }

  const options =
    typeof params === "object" && params !== null && "options" in params
      ? params.options
      : undefined;
  if (
    typeof options === "object" &&
    options !== null &&
    "transaction" in options &&
    options.transaction === true
  ) {
    return false;
  }

  return commands.every(
    (command) =>
      typeof command === "object" &&
      command !== null &&
      "sql" in command &&
      typeof command.sql === "string" &&
      isLikelyReadOnlySql(command.sql),
  );
};

export const isSqlInputItemParallelismSafe = (
  context: IExecuteFunctions,
  itemCount: number,
): boolean => {
  if (itemCount <= 1) {
    return false;
  }

  const operation = context.getNodeParameter("operation", 0) as string;

  switch (operation) {
    case "validateContext":
    case "discoverRpc":
    case "getAgentProfile":
    case "getClientTokenPolicy":
      return true;
    case "executeSql": {
      const inputMode = context.getNodeParameter("inputMode", 0, "guided") as string;
      if (inputMode === "advanced") {
        return Array.from({ length: itemCount }, (_, itemIndex) =>
          isAdvancedSqlItemReadOnly(context, itemIndex, "executeSql"),
        ).every(Boolean);
      }

      return Array.from({ length: itemCount }, (_, itemIndex) =>
        isGuidedExecuteSqlItemReadOnly(context, itemIndex),
      ).every(Boolean);
    }
    case "executeBatch": {
      const inputMode = context.getNodeParameter("inputMode", 0, "guided") as string;
      if (inputMode === "advanced") {
        return Array.from({ length: itemCount }, (_, itemIndex) =>
          isAdvancedSqlItemReadOnly(context, itemIndex, "executeBatch"),
        ).every(Boolean);
      }

      return Array.from({ length: itemCount }, (_, itemIndex) =>
        isGuidedExecuteBatchItemReadOnly(context, itemIndex),
      ).every(Boolean);
    }
    default:
      return false;
  }
};

export const resolvePlugSqlInputItemParallelism = (
  context: IExecuteFunctions,
  sourceItems: readonly INodeExecutionData[],
): number => {
  const useEmptyInput = sourceItems.length === 0;
  const itemCount = useEmptyInput ? 1 : sourceItems.length;
  const allowParallel = isSqlInputItemParallelismSafe(context, itemCount);
  const operation = context.getNodeParameter("operation", 0) as string;
  const optionsCollection = sqlOptionsCollectionForOperation(operation);
  const options =
    optionsCollection === undefined
      ? {}
      : toCollection(context, optionsCollection, 0);
  const explicitValue = toOptionalPositiveNumber(options.maxParallelInputItems);
  const maxParallelExplicit = "maxParallelInputItems" in options;
  const hintsEnabled = toOptionalBoolean(options.autoPerformanceHints) ?? true;

  return resolveMaxParallelInputItems(
    allowParallel,
    maxParallelExplicit ? explicitValue : undefined,
    hintsEnabled,
    itemCount,
  );
};
