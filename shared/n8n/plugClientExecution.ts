import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { DEFAULT_API_VERSION, DEFAULT_BASE_URL } from "../contracts/api";
import type {
  BridgeCommand,
  BuiltCommandRequest,
  JsonObject,
  PlugChannel,
  PlugCommandTransportResult,
  PlugCredentialDefaults,
  PlugResolvedExecutionContext,
  PlugResponseMode,
  PlugSocketImplementation,
  RpcSingleCommand,
  SqlExecuteBatchCommandItem,
} from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import {
  createExecutionSessionRunner,
  type PlugExecutionSessionRunner,
} from "../auth/session";
import { buildNodeOutputItems } from "../output/nodeOutput";
import { executeRestCommand } from "../rest/client";
import { isRecord, parseOptionalJsonArray, parseOptionalJsonObject } from "../utils/json";

export interface PlugSocketExecutor {
  (input: {
    readonly session: import("../contracts/api").PlugSession<PlugCredentialDefaults>;
    readonly agentId: string;
    readonly command: BridgeCommand;
    readonly timeoutMs?: number;
    readonly payloadFrameCompression?: import("../contracts/api").PayloadFrameCompression;
    readonly responseMode: PlugResponseMode;
  }): Promise<PlugCommandTransportResult>;
}

export interface PlugClientNodeExecutionConfig {
  readonly supportsSocket: boolean;
  readonly credentialName?: string;
  readonly nodeDisplayName?: string;
  readonly socketExecutor?: PlugSocketExecutor;
  readonly legacySocketExecutor?: PlugSocketExecutor;
}

const retryableOperations = new Set([
  "validateContext",
  "discoverRpc",
  "getAgentProfile",
  "getClientTokenPolicy",
]);

const operationMethodMap: Record<string, RpcSingleCommand["method"]> = {
  executeSql: "sql.execute",
  executeBatch: "sql.executeBatch",
  cancelSql: "sql.cancel",
  discoverRpc: "rpc.discover",
  getAgentProfile: "agent.getProfile",
  getClientTokenPolicy: "client_token.getPolicy",
};

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const toOptionalPositiveNumber = (value: unknown): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
};

const toOptionalBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const toCollection = (
  context: IExecuteFunctions,
  parameterName: string,
  itemIndex: number,
): IDataObject => context.getNodeParameter(parameterName, itemIndex, {}) as IDataObject;

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

const operationsRequiringClientToken = new Set([
  "validateContext",
  "executeSql",
  "executeBatch",
  "getAgentProfile",
  "getClientTokenPolicy",
]);

const resolveSocketImplementation = (
  context: IExecuteFunctions,
): PlugSocketImplementation =>
  context.getNode().typeVersion >= 2 ? "agentsCommand" : "relay";

const buildHttpRequester = (
  context: IExecuteFunctions,
): import("../contracts/api").PlugHttpRequester => {
  return async (options) => {
    const requestOptions: IHttpRequestOptions = {
      method: options.method,
      url: options.url,
      headers: options.headers,
      ...(options.body !== undefined
        ? {
            body: options.body as NonNullable<IHttpRequestOptions["body"]>,
          }
        : {}),
      timeout: options.timeoutMs,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
      json: true,
    };

    const response = await context.helpers.httpRequest(requestOptions);
    const responseBody =
      isRecord(response) && "body" in response ? response.body : response;
    const responseHeaders =
      isRecord(response) && isRecord(response.headers)
        ? (response.headers as Record<string, string | string[] | undefined>)
        : {};
    const statusCode =
      isRecord(response) && typeof response.statusCode === "number"
        ? response.statusCode
        : 200;

    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody,
    };
  };
};

const readCredentials = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<PlugCredentialDefaults> => {
  const rawCredentials = await context.getCredentials(
    config.credentialName ?? "plugClientApi",
  );

  return {
    user: String(rawCredentials.user ?? ""),
    password: String(rawCredentials.password ?? ""),
    agentId: toOptionalString(rawCredentials.agentId),
    clientToken: toOptionalString(rawCredentials.clientToken),
    baseUrl: DEFAULT_BASE_URL,
  };
};

const applyCommandDefaults = (
  command: RpcSingleCommand,
  executionContext: PlugResolvedExecutionContext,
  apiVersion?: string,
  meta?: JsonObject,
): RpcSingleCommand => {
  const nextCommand: RpcSingleCommand = {
    ...command,
    jsonrpc: "2.0",
    api_version: apiVersion ?? command.api_version ?? DEFAULT_API_VERSION,
    ...(meta ? { meta: meta } : command.meta ? { meta: command.meta } : {}),
  } as RpcSingleCommand;

  if (nextCommand.method === "sql.execute") {
    return {
      ...nextCommand,
      params: {
        ...nextCommand.params,
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  if (nextCommand.method === "sql.executeBatch") {
    return {
      ...nextCommand,
      params: {
        ...nextCommand.params,
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  if (
    nextCommand.method === "agent.getProfile" ||
    nextCommand.method === "client_token.getPolicy"
  ) {
    return {
      ...nextCommand,
      params: {
        ...(nextCommand.params ?? {}),
        client_token: executionContext.resolvedClientToken,
      },
    };
  }

  return nextCommand;
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

const buildGuidedSqlCommand = (
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
  const page = toOptionalPositiveNumber(options.page);
  const pageSize = toOptionalPositiveNumber(options.pageSize);
  const cursor = toOptionalString(options.cursor);
  const database = toOptionalString(options.database);
  const idempotencyKey = toOptionalString(options.idempotencyKey);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

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

const buildGuidedBatchCommand = (
  context: IExecuteFunctions,
  itemIndex: number,
  executionContext: PlugResolvedExecutionContext,
): BuiltCommandRequest => {
  const batchCommandsJson = context.getNodeParameter(
    "batchCommandsJson",
    itemIndex,
  ) as string;
  const options = toCollection(context, "batchOptions", itemIndex);
  const commands = parseOptionalJsonArray(batchCommandsJson, "Batch Commands JSON");
  if (!commands || commands.length === 0) {
    throw new PlugValidationError(
      "Batch Commands JSON must contain at least one command",
    );
  }

  const timeoutMs = toOptionalPositiveNumber(options.timeoutMs);
  const maxRows = toOptionalPositiveNumber(options.maxRows);
  const transaction = toOptionalBoolean(options.transaction);
  const database = toOptionalString(options.database);
  const idempotencyKey = toOptionalString(options.idempotencyKey);
  const apiVersion = toOptionalString(options.apiVersion) ?? DEFAULT_API_VERSION;
  const meta = parseOptionalJsonObject(String(options.metaJson ?? ""), "RPC Meta JSON");

  const batchItems = commands.map((item, index) => {
    if (!isRecord(item)) {
      throw new PlugValidationError(`Batch command at index ${index} must be an object`);
    }
    if (typeof item.sql !== "string" || item.sql.trim() === "") {
      throw new PlugValidationError(`Batch command at index ${index} must include sql`);
    }

    return {
      sql: item.sql,
      ...(isRecord(item.params) ? { params: item.params } : {}),
      ...(typeof item.execution_order === "number"
        ? { execution_order: item.execution_order }
        : {}),
    } as SqlExecuteBatchCommandItem;
  });

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

const buildGuidedCancelCommand = (
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

  const profileOptions =
    operation === "executeSql"
      ? toCollection(context, "sqlOptions", itemIndex)
      : operation === "executeBatch"
        ? toCollection(context, "batchOptions", itemIndex)
        : operation === "cancelSql"
          ? toCollection(context, "cancelOptions", itemIndex)
          : operation === "discoverRpc"
            ? toCollection(context, "discoverOptions", itemIndex)
            : toCollection(context, "profileOptions", itemIndex);

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
  const channel = config.supportsSocket
    ? (context.getNodeParameter("channel", itemIndex, "rest") as PlugChannel)
    : "rest";
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

  return {
    ...builtRequest,
    channel:
      operation === "executeBatch" &&
      (!config.supportsSocket || resolveSocketImplementation(context) === "relay")
        ? "rest"
        : !config.supportsSocket
          ? "rest"
          : channel,
    ...(channel === "socket" && config.supportsSocket
      ? {
          socketImplementation: resolveSocketImplementation(context),
          payloadFrameCompression: "default" as const,
        }
      : {}),
    responseMode:
      operation === "validateContext"
        ? "aggregatedJson"
        : getResponseMode(context, itemIndex),
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
        responseMode: builtRequest.responseMode,
      });
    }

    return executeRestCommand(requester, session, builtRequest);
  });

const shouldRetryBuiltRequest = (
  builtRequest: BuiltCommandRequest,
  error: unknown,
  attemptNumber: number,
): error is PlugError => {
  if (attemptNumber > 0) {
    return false;
  }

  if (!(error instanceof PlugError) || !error.retryable) {
    return false;
  }

  return retryableOperations.has(builtRequest.operation);
};

const toNodeItems = (jsonItems: JsonObject[]): INodeExecutionData[] =>
  jsonItems.map((json) => ({ json: json as IDataObject }));

const serializeErrorForContinueOnFail = (error: unknown): IDataObject => {
  if (error instanceof PlugError) {
    return {
      message: error.message,
      description: error.description,
      code: error.code,
      statusCode: error.statusCode,
      correlationId: error.correlationId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      technicalMessage: error.technicalMessage,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: "Unknown error",
  };
};

export const executePlugClientNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const sourceItems = context.getInputData();
  const items =
    sourceItems.length > 0 ? sourceItems : [{ json: {} } as INodeExecutionData];
  const credentials = await readCredentials(context, config);
  const requester = buildHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const builtRequest = buildBuiltCommandRequest(
        context,
        itemIndex,
        credentials,
        config,
      );
      let transportResult: PlugCommandTransportResult | undefined;

      for (let attemptNumber = 0; attemptNumber < 2; attemptNumber += 1) {
        try {
          transportResult = await executeBuiltRequest(
            requester,
            sessionRunner,
            builtRequest,
            config,
          );
          break;
        } catch (error: unknown) {
          if (!shouldRetryBuiltRequest(builtRequest, error, attemptNumber)) {
            throw error;
          }
        }
      }

      if (!transportResult) {
        throw new PlugValidationError("Plug request finished without a transport result");
      }

      const jsonItems = buildNodeOutputItems(
        transportResult,
        builtRequest.responseMode,
        getIncludeMetadata(context, itemIndex),
      );
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
