import type { IExecuteFunctions } from "n8n-workflow";

import { DEFAULT_API_VERSION, DEFAULT_BASE_URL } from "../contracts/api";
import type {
  BuiltCommandRequest,
  PlugChannel,
  PlugCredentialDefaults,
  PlugResolvedExecutionContext,
  PlugSocketImplementation,
  RpcSingleCommand,
} from "../contracts/api";
import { PlugValidationError } from "../contracts/errors";
import { parseOptionalJsonObject } from "../utils/json";
import { applyCommandDefaults } from "./plugCommandDefaults";
import {
  toCollection,
  toOptionalPositiveNumber,
  toOptionalString,
} from "./plugExecutionParameters";
import {
  buildGuidedBatchCommand,
  buildGuidedBulkInsertCommand,
  buildGuidedCancelCommand,
  buildGuidedSqlCommand,
} from "./plugSqlGuidedCommands";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";

export const defaultSocketBufferLimits = {
  maxBufferedChunkItems: 512,
  maxBufferedRows: 50_000,
  maxBufferedBytes: 8 * 1024 * 1024,
} as const;

export const defaultSocketStreamPullWindowSize = 32;
export const maxSocketStreamPullWindowSize = 1000;

const operationMethodMap: Record<string, RpcSingleCommand["method"]> = {
  executeSql: "sql.execute",
  executeBatch: "sql.executeBatch",
  bulkInsertSql: "sql.bulkInsert",
  cancelSql: "sql.cancel",
  discoverRpc: "rpc.discover",
  getAgentProfile: "agent.getProfile",
  getClientTokenPolicy: "client_token.getPolicy",
};

const operationsRequiringClientToken = new Set([
  "validateContext",
  "executeSql",
  "executeBatch",
  "bulkInsertSql",
  "getAgentProfile",
  "getClientTokenPolicy",
]);

const resolveSocketImplementation = (
  context: IExecuteFunctions,
): PlugSocketImplementation =>
  context.getNode().typeVersion >= 2 ? "agentsCommand" : "relay";

export const readPlugClientCredentials = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<PlugCredentialDefaults> => {
  const rawCredentials = await context.getCredentials(
    config.credentialName ?? "plugDatabaseAccountApi",
  );

  return {
    user: String(rawCredentials.user ?? ""),
    password: String(rawCredentials.password ?? ""),
    agentId: toOptionalString(rawCredentials.agentId),
    clientToken: toOptionalString(rawCredentials.clientToken),
    payloadSigningKey: toOptionalString(rawCredentials.payloadSigningKey),
    payloadSigningKeyId: toOptionalString(rawCredentials.payloadSigningKeyId),
    baseUrl: DEFAULT_BASE_URL,
  };
};

export const resolvePlugExecutionContext = (
  context: IExecuteFunctions,
  itemIndex: number,
  credentialDefaults: PlugCredentialDefaults,
  operation: string,
): PlugResolvedExecutionContext => {
  const nodeAgentId = toOptionalString(
    context.getNodeParameter("agentId", itemIndex, ""),
  );
  const nodeClientToken = toOptionalString(
    context.getNodeParameter("clientToken", itemIndex, ""),
  );
  const resolvedAgentId = nodeAgentId ?? credentialDefaults.agentId;
  const resolvedClientToken = nodeClientToken ?? credentialDefaults.clientToken;

  if (!resolvedAgentId) {
    throw new PlugValidationError(
      "Agent ID is required. Set it on the node or configure Default Agent ID in the credential.",
    );
  }

  if (operationsRequiringClientToken.has(operation) && !resolvedClientToken) {
    throw new PlugValidationError(
      "Client Token is required for this operation. Set it on the node or configure Default Client Token in the credential.",
    );
  }

  return {
    user: credentialDefaults.user,
    password: credentialDefaults.password,
    baseUrl: credentialDefaults.baseUrl,
    resolvedAgentId,
    ...(resolvedClientToken ? { resolvedClientToken } : {}),
  };
};

const buildGuidedDiscoverCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
): BuiltCommandRequest => {
  const paramsJson = context.getNodeParameter(
    "discoverParamsJson",
    itemIndex,
    "",
  ) as string;
  const params = parseOptionalJsonObject(paramsJson, "Discover Params JSON");
  const options = toCollection(context, "discoverOptions", itemIndex);
  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

  return {
    operation: "discoverRpc",
    channel: "rest",
    responseMode: "aggregatedJson",
    command: applyCommandDefaults(
      {
        method: "rpc.discover",
        ...(params ? { params } : {}),
      },
      executionContext,
      apiVersion,
      meta,
    ),
    agentId: executionContext.resolvedAgentId,
    timeoutMs,
  };
};

const buildGuidedProfileCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
  operation: "getAgentProfile" | "getClientTokenPolicy",
): BuiltCommandRequest => {
  const options = toCollection(context, "profileOptions", itemIndex);
  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

  return {
    operation,
    channel: "rest",
    responseMode: "aggregatedJson",
    command: applyCommandDefaults(
      {
        method: operationMethodMap[operation],
      } as RpcSingleCommand,
      executionContext,
      apiVersion,
      meta,
    ),
    agentId: executionContext.resolvedAgentId,
    timeoutMs,
  };
};

const buildValidateContextCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
): BuiltCommandRequest => {
  const options = toCollection(context, "validateContextOptions", itemIndex);
  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);

  return {
    operation: "validateContext",
    channel: "rest",
    responseMode: "aggregatedJson",
    command: applyCommandDefaults(
      {
        method: "client_token.getPolicy",
      },
      executionContext,
      DEFAULT_API_VERSION,
    ),
    agentId: executionContext.resolvedAgentId,
    timeoutMs,
  };
};

const buildAdvancedCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
  operation: string,
): BuiltCommandRequest => {
  const advancedCommandJson = context.getNodeParameter(
    "advancedCommandJson",
    itemIndex,
  ) as string;
  const parsed = parseOptionalJsonObject(advancedCommandJson, "Raw JSON-RPC Command");
  if (!parsed) {
    throw new PlugValidationError("Raw JSON-RPC Command is required");
  }

  const expectedMethod = operationMethodMap[operation];
  if (parsed.method !== expectedMethod) {
    throw new PlugValidationError(
      `Raw JSON-RPC Command method must be ${expectedMethod} for the selected operation`,
    );
  }

  const operationOptionsCollectionMap: Record<string, string> = {
    executeSql: "sqlOptions",
    executeBatch: "batchOptions",
    bulkInsertSql: "bulkInsertOptions",
    cancelSql: "cancelOptions",
    discoverRpc: "discoverOptions",
  };
  const profileOptions = toCollection(
    context,
    operationOptionsCollectionMap[operation] ?? "profileOptions",
    itemIndex,
  );

  const timeoutMs = toOptionalPositiveNumber(profileOptions.timeoutMs);
  const apiVersion = toOptionalString(profileOptions.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(
    String(profileOptions.metaJson ?? ""),
    "RPC Meta JSON",
  );

  return {
    operation: operation as BuiltCommandRequest["operation"],
    channel: "rest",
    responseMode: "aggregatedJson",
    command: applyCommandDefaults(
      parsed as unknown as RpcSingleCommand,
      executionContext,
      apiVersion,
      meta,
    ),
    agentId: executionContext.resolvedAgentId,
    timeoutMs,
  };
};

export const getPlugResponseMode = (
  context: IExecuteFunctions,
  itemIndex: number,
): BuiltCommandRequest["responseMode"] =>
  context.getNodeParameter(
    "responseMode",
    itemIndex,
    "aggregatedJson",
  ) as BuiltCommandRequest["responseMode"];

export const getPlugIncludeMetadata = (
  context: IExecuteFunctions,
  itemIndex: number,
): boolean => context.getNodeParameter("includePlugMetadata", itemIndex, true) as boolean;

const resolveSocketBufferLimits = (
  context: IExecuteFunctions,
  itemIndex: number,
): BuiltCommandRequest["bufferLimits"] => {
  const socketOptions = toCollection(context, "socketOptions", itemIndex);
  const maxBufferedChunkItems = toOptionalPositiveNumber(socketOptions.maxBufferedChunks);
  const maxBufferedRows = toOptionalPositiveNumber(socketOptions.maxBufferedRows);
  const maxBufferedBytes = toOptionalPositiveNumber(socketOptions.maxBufferedBytes);

  return {
    maxBufferedChunkItems:
      maxBufferedChunkItems ?? defaultSocketBufferLimits.maxBufferedChunkItems,
    maxBufferedRows: maxBufferedRows ?? defaultSocketBufferLimits.maxBufferedRows,
    maxBufferedBytes: maxBufferedBytes ?? defaultSocketBufferLimits.maxBufferedBytes,
  };
};

const resolveSocketStreamPullWindowSize = (
  context: IExecuteFunctions,
  itemIndex: number,
): number => {
  const socketOptions = toCollection(context, "socketOptions", itemIndex);
  const configured = toOptionalPositiveNumber(socketOptions.streamPullWindowSize);
  if (configured === undefined) {
    return defaultSocketStreamPullWindowSize;
  }

  return Math.min(maxSocketStreamPullWindowSize, Math.max(1, Math.floor(configured)));
};

export const finalizeBuiltCommandRequest = (
  builtRequest: BuiltCommandRequest,
  context: IExecuteFunctions,
  itemIndex: number,
  config: PlugClientNodeExecutionConfig,
  operation?: string,
): BuiltCommandRequest => {
  const resolvedOperation =
    operation ?? (context.getNodeParameter("operation", itemIndex) as string);
  const channel = config.supportsSocket
    ? (context.getNodeParameter("channel", itemIndex, "rest") as PlugChannel)
    : "rest";

  return {
    ...builtRequest,
    channel: !config.supportsSocket ? "rest" : channel,
    ...(channel === "socket" && config.supportsSocket
      ? {
          socketImplementation: resolveSocketImplementation(context),
          payloadFrameCompression: "default" as const,
          bufferLimits: resolveSocketBufferLimits(context, itemIndex),
          streamPullWindowSize: resolveSocketStreamPullWindowSize(context, itemIndex),
        }
      : {}),
    responseMode:
      resolvedOperation === "validateContext"
        ? "aggregatedJson"
        : getPlugResponseMode(context, itemIndex),
  };
};

export const buildBuiltCommandRequest = (
  context: IExecuteFunctions,
  itemIndex: number,
  credentialDefaults: PlugCredentialDefaults,
  config: PlugClientNodeExecutionConfig,
): BuiltCommandRequest => {
  const operation = context.getNodeParameter("operation", itemIndex) as string;
  const executionContext = resolvePlugExecutionContext(
    context,
    itemIndex,
    credentialDefaults,
    operation,
  );
  const inputMode =
    operation === "validateContext"
      ? "guided"
      : (context.getNodeParameter("inputMode", itemIndex, "guided") as string);

  const builtRequest =
    operation === "validateContext"
      ? buildValidateContextCommand(context, itemIndex, executionContext)
      : inputMode === "advanced"
        ? buildAdvancedCommand(context, itemIndex, executionContext, operation)
        : operation === "executeSql"
          ? buildGuidedSqlCommand(context, itemIndex, executionContext)
          : operation === "executeBatch"
            ? buildGuidedBatchCommand(context, itemIndex, executionContext)
            : operation === "bulkInsertSql"
              ? buildGuidedBulkInsertCommand(context, itemIndex, executionContext)
              : operation === "cancelSql"
                ? buildGuidedCancelCommand(context, itemIndex, executionContext)
                : operation === "discoverRpc"
                  ? buildGuidedDiscoverCommand(context, itemIndex, executionContext)
                  : buildGuidedProfileCommand(
                      context,
                      itemIndex,
                      executionContext,
                      operation as "getAgentProfile" | "getClientTokenPolicy",
                    );

  return finalizeBuiltCommandRequest(builtRequest, context, itemIndex, config, operation);
};
