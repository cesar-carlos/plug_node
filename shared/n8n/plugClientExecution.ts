import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { DEFAULT_API_VERSION, DEFAULT_BASE_URL } from "../contracts/api";
import type {
  BridgeCommand,
  BuiltCommandRequest,
  JsonObject,
  PayloadFrameCompression,
  PlugChannel,
  PlugCommandTransportResult,
  PlugCredentialDefaults,
  PlugResolvedExecutionContext,
  PlugResponseMode,
  PlugSocketImplementation,
  PlugTransportExecutionMetrics,
  RpcSingleCommand,
} from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import {
  createExecutionSessionRunner,
  type PlugExecutionSessionRunner,
} from "../auth/session";
import { executePlugClientAccessNode } from "./plugClientAccessExecution";
import {
  executePlugToolsResource,
  type PlugToolsSocketEventListener,
  type PlugToolsSocketEventPublisher,
} from "./plugToolsExecution";
import { executePlugUserAccessNode } from "./plugUserAccessExecution";
import { buildN8nHttpRequester } from "./httpRequester";
import { serializeErrorForContinueOnFail } from "../output/errorOutput";
import { buildNodeOutputItems } from "../output/nodeOutput";
import { executeRestCommand } from "../rest/client";
import { isRecord, parseOptionalJsonObject } from "../utils/json";
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
import {
  buildCoalescedBatchRequest,
  shouldCoalesceBatchInputItems,
} from "./plugBatchCoalesce";
import {
  computeRetryDelayMs,
  MAX_TRANSIENT_RETRIES,
  shouldRetryPlugOperation,
  sleepMs,
} from "./plugTransientRetry";

export interface PlugSocketExecutor {
  (input: {
    readonly session: import("../contracts/api").PlugSession<PlugCredentialDefaults>;
    readonly agentId: string;
    readonly command: BridgeCommand;
    readonly timeoutMs?: number;
    readonly payloadFrameCompression?: PayloadFrameCompression;
    readonly payloadFrameSigning?: {
      readonly key?: string;
      readonly keyId?: string;
    };
    readonly responseMode: PlugResponseMode;
    readonly bufferLimits?: {
      readonly maxBufferedChunkItems?: number;
      readonly maxBufferedRows?: number;
      readonly maxBufferedBytes?: number;
    };
    readonly streamPullWindowSize?: number;
  }): Promise<PlugCommandTransportResult>;
}

export interface PlugClientNodeExecutionConfig {
  readonly supportsSocket: boolean;
  readonly credentialName?: string;
  readonly nodeDisplayName?: string;
  readonly socketExecutor?: PlugSocketExecutor;
  readonly legacySocketExecutor?: PlugSocketExecutor;
  readonly toolSocketEventPublisher?: PlugToolsSocketEventPublisher;
  readonly socketEventListener?: PlugToolsSocketEventListener;
}

const operationMethodMap: Record<string, RpcSingleCommand["method"]> = {
  executeSql: "sql.execute",
  executeBatch: "sql.executeBatch",
  bulkInsertSql: "sql.bulkInsert",
  cancelSql: "sql.cancel",
  discoverRpc: "rpc.discover",
  getAgentProfile: "agent.getProfile",
  getClientTokenPolicy: "client_token.getPolicy",
};

const getResponseMode = (
  context: IExecuteFunctions,
  itemIndex: number,
): PlugResponseMode => {
  return context.getNodeParameter(
    "responseMode",
    itemIndex,
    "aggregatedJson",
  ) as PlugResponseMode;
};

const getIncludeMetadata = (context: IExecuteFunctions, itemIndex: number): boolean =>
  context.getNodeParameter("includePlugMetadata", itemIndex, true) as boolean;

const defaultSocketBufferLimits = {
  maxBufferedChunkItems: 512,
  maxBufferedRows: 50_000,
  maxBufferedBytes: 8 * 1024 * 1024,
} as const;

const defaultSocketStreamPullWindowSize = 32;
const maxSocketStreamPullWindowSize = 1000;

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

const readCredentials = async (
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

const resolveExecutionContext = (
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

const buildBuiltCommandRequest = (
  context: IExecuteFunctions,
  itemIndex: number,
  credentialDefaults: PlugCredentialDefaults,
  config: PlugClientNodeExecutionConfig,
): BuiltCommandRequest => {
  const operation = context.getNodeParameter("operation", itemIndex) as string;
  const executionContext = resolveExecutionContext(
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

const finalizeBuiltCommandRequest = (
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
        : getResponseMode(context, itemIndex),
  };
};

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

const resolvePayloadFrameSigning = (
  session: import("../contracts/api").PlugSession<PlugCredentialDefaults>,
):
  | {
      readonly key?: string;
      readonly keyId?: string;
    }
  | undefined => {
  const key = toOptionalString(session.credentials.payloadSigningKey);
  const keyId = toOptionalString(session.credentials.payloadSigningKeyId);
  if (!key && !keyId) {
    return undefined;
  }

  return {
    ...(key ? { key } : {}),
    ...(keyId ? { keyId } : {}),
  };
};

const executeBuiltRequest = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: PlugExecutionSessionRunner<PlugCredentialDefaults>,
  builtRequest: BuiltCommandRequest,
  config: PlugClientNodeExecutionConfig,
): Promise<PlugCommandTransportResult> =>
  sessionRunner(async (session) => {
    if (builtRequest.channel === "socket") {
      const socketImplementation = builtRequest.socketImplementation ?? "relay";
      const socketExecutor =
        socketImplementation === "relay"
          ? (config.legacySocketExecutor ?? config.socketExecutor)
          : config.socketExecutor;

      if (!config.supportsSocket || !socketExecutor) {
        throw new PlugValidationError(
          "This package does not support the socket channel.",
        );
      }

      if (socketImplementation === "relay" && Array.isArray(builtRequest.command)) {
        throw new PlugValidationError(
          "Socket channel requires a single JSON-RPC command.",
        );
      }

      return socketExecutor({
        session,
        agentId: builtRequest.agentId,
        command: builtRequest.command,
        timeoutMs: builtRequest.timeoutMs,
        payloadFrameCompression: builtRequest.payloadFrameCompression,
        payloadFrameSigning: resolvePayloadFrameSigning(session),
        responseMode: builtRequest.responseMode,
        bufferLimits: builtRequest.bufferLimits,
        streamPullWindowSize: builtRequest.streamPullWindowSize,
      });
    }

    return executeRestCommand(requester, session, builtRequest);
  });

const toNodeItems = (jsonItems: JsonObject[]): INodeExecutionData[] =>
  jsonItems.map((json) => ({ json: json as IDataObject }));

const attachTransportExecutionMetrics = (
  transportResult: PlugCommandTransportResult,
  executionMetrics: PlugTransportExecutionMetrics,
): PlugCommandTransportResult => {
  if (transportResult.notification) {
    return transportResult;
  }

  if (transportResult.channel === "rest") {
    return {
      ...transportResult,
      executionMetrics: {
        ...transportResult.executionMetrics,
        ...executionMetrics,
      },
    };
  }

  return {
    ...transportResult,
    executionMetrics: {
      ...transportResult.executionMetrics,
      ...executionMetrics,
      connectedAfterMs:
        transportResult.executionMetrics?.connectedAfterMs ??
        executionMetrics.connectedAfterMs,
    },
  };
};

const executeBuiltCommandWithRetry = async (input: {
  readonly builtRequest: BuiltCommandRequest;
  readonly requester: import("../contracts/api").PlugHttpRequester;
  readonly sessionRunner: PlugExecutionSessionRunner<PlugCredentialDefaults>;
  readonly config: PlugClientNodeExecutionConfig;
  readonly includeMetadata: boolean;
}): Promise<{
  readonly transportResult: PlugCommandTransportResult;
  readonly jsonItems: JsonObject[];
  readonly attemptCount: number;
  readonly lastRetryDelayMs?: number;
}> => {
  let lastRetryDelayMs: number | undefined;

  for (
    let attemptNumber = 0;
    attemptNumber <= MAX_TRANSIENT_RETRIES;
    attemptNumber += 1
  ) {
    try {
      const transportResult = await executeBuiltRequest(
        input.requester,
        input.sessionRunner,
        input.builtRequest,
        input.config,
      );
      const executionMetrics: PlugTransportExecutionMetrics = {
        attemptCount: attemptNumber + 1,
        lastRetryDelayMs,
        connectedAfterMs:
          transportResult.channel === "socket" && !transportResult.notification
            ? transportResult.executionMetrics?.connectedAfterMs
            : undefined,
      };
      const transportWithMetrics = attachTransportExecutionMetrics(
        transportResult,
        executionMetrics,
      );
      const jsonItems = buildNodeOutputItems(
        transportWithMetrics,
        input.builtRequest.responseMode,
        input.includeMetadata,
      );

      return {
        transportResult: transportWithMetrics,
        jsonItems,
        attemptCount: attemptNumber + 1,
        lastRetryDelayMs,
      };
    } catch (error: unknown) {
      if (
        !shouldRetryPlugOperation({
          operation: input.builtRequest.operation,
          error,
          attemptNumber,
        })
      ) {
        throw error;
      }

      const delayMs =
        error instanceof PlugError
          ? computeRetryDelayMs(error, attemptNumber)
          : computeRetryDelayMs(
              new PlugError("Plug request timed out before completion.", {
                code: "PLUG_TIMEOUT",
                retryable: true,
              }),
              attemptNumber,
            );
      lastRetryDelayMs = delayMs;
      await sleepMs(delayMs);
    }
  }

  throw new PlugValidationError("Plug request finished without a successful attempt");
};

const attachCoalescedItemCount = (
  jsonItems: JsonObject[],
  includeMetadata: boolean,
  coalescedItemCount: number,
): JsonObject[] => {
  if (!includeMetadata) {
    return jsonItems;
  }

  return jsonItems.map((json) => {
    const plugMeta = isRecord(json.__plug) ? json.__plug : {};
    return {
      ...json,
      __plug: {
        ...plugMeta,
        coalescedItemCount,
      },
    };
  });
};

const executePlugSqlNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const sourceItems = context.getInputData();
  const items =
    sourceItems.length > 0 ? sourceItems : [{ json: {} } as INodeExecutionData];
  const credentials = await readCredentials(context, config);
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const outputItems: INodeExecutionData[] = [];

  if (shouldCoalesceBatchInputItems(context, 0)) {
    const includeMetadata = getIncludeMetadata(context, 0);
    const { builtRequest, coalescedItemCount } = buildCoalescedBatchRequest({
      context,
      credentialDefaults: credentials,
      config,
      resolveExecutionContext,
      finalizeBuiltRequest: finalizeBuiltCommandRequest,
    });
    const { jsonItems } = await executeBuiltCommandWithRetry({
      builtRequest,
      requester,
      sessionRunner,
      config,
      includeMetadata,
    });

    return [
      toNodeItems(
        attachCoalescedItemCount(jsonItems, includeMetadata, coalescedItemCount),
      ),
    ];
  }

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const builtRequest = buildBuiltCommandRequest(
        context,
        itemIndex,
        credentials,
        config,
      );
      const { jsonItems } = await executeBuiltCommandWithRetry({
        builtRequest,
        requester,
        sessionRunner,
        config,
        includeMetadata: getIncludeMetadata(context, itemIndex),
      });
      outputItems.push(...toNodeItems(jsonItems));
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            ...items[itemIndex].json,
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
        continue;
      }

      const nodeError =
        error instanceof Error || typeof error === "string"
          ? error
          : isRecord(error)
            ? JSON.stringify(error)
            : new Error(`Unknown ${config.nodeDisplayName ?? "Plug Client"} error`);

      throw new NodeOperationError(context.getNode(), nodeError, {
        itemIndex,
      });
    }
  }

  return [outputItems];
};

type PlugUnifiedResource = "sql" | "clientAccess" | "userAccess" | "tools";

const resolveUnifiedResource = (
  context: IExecuteFunctions,
  itemIndex: number,
): PlugUnifiedResource =>
  context.getNodeParameter("resource", itemIndex, "sql") as PlugUnifiedResource;

export const executePlugClientNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const resource = resolveUnifiedResource(context, 0);
  const sourceItems = context.getInputData();
  const itemCount = sourceItems.length > 0 ? sourceItems.length : 1;

  for (let itemIndex = 1; itemIndex < itemCount; itemIndex += 1) {
    const nextResource = resolveUnifiedResource(context, itemIndex);
    if (nextResource !== resource) {
      throw new PlugValidationError(
        "Resource must stay the same for every item in one node execution.",
      );
    }
  }

  switch (resource) {
    case "sql":
      return executePlugSqlNode(context, config);
    case "clientAccess":
      return executePlugClientAccessNode(context, {
        credentialName: config.credentialName,
        nodeDisplayName: config.nodeDisplayName,
      });
    case "userAccess":
      return executePlugUserAccessNode(context, {
        credentialName: config.credentialName,
        nodeDisplayName: config.nodeDisplayName,
      });
    case "tools":
      return executePlugToolsResource(context, {
        credentialName: config.credentialName,
        nodeDisplayName: config.nodeDisplayName ?? "Plug Database",
        socketEventPublisher: config.toolSocketEventPublisher,
        socketEventListener: config.socketEventListener,
      });
    default: {
      const exhaustiveCheck: never = resource;
      throw new PlugValidationError(`Unsupported Plug resource: ${exhaustiveCheck}`);
    }
  }
};
