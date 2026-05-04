import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import type { PlugClientAuthCredentials } from "../contracts/api";
import type {
  ClientAccessExecutionResult,
  ClientAccessOperation,
  ClientAccessRequestStatus,
  ClientAgentStatus,
} from "../contracts/client-access";
import { DEFAULT_BASE_URL } from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { createExecutionSessionRunner } from "../auth/session";
import { buildClientAccessOutputItems } from "../output/clientAccessOutput";
import { collectAllPages } from "../rest/resourceClient";
import {
  getClientAgent,
  getClientAgentToken,
  listClientAccessRequests,
  listClientAgents,
  requestClientAgentAccess,
  revokeClientAgentAccess,
  setClientAgentToken,
} from "../rest/clientAccess";
import { isRecord, parseStringListCollection } from "../utils/json";

export interface PlugClientAccessNodeExecutionConfig {
  readonly credentialName?: string;
  readonly nodeDisplayName?: string;
}

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const toPositiveInteger = (value: unknown, label: string): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    if (value === undefined || value === null || value === 0) {
      return undefined;
    }

    throw new PlugValidationError(`${label} must be a positive number`);
  }

  return Math.trunc(value);
};

const toStatusFilter = <TStatus extends string>(
  value: unknown,
  allowedValues: readonly TStatus[],
  label: string,
): TStatus | undefined => {
  if (value === "all" || value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string" || !allowedValues.includes(value as TStatus)) {
    throw new PlugValidationError(`${label} must be one of: ${allowedValues.join(", ")}`);
  }

  return value as TStatus;
};

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
  config: PlugClientAccessNodeExecutionConfig,
): Promise<PlugClientAuthCredentials> => {
  const rawCredentials = await context.getCredentials(
    config.credentialName ?? "plugDatabaseClientApi",
  );

  return {
    user: String(rawCredentials.user ?? ""),
    password: String(rawCredentials.password ?? ""),
    baseUrl: DEFAULT_BASE_URL,
  };
};

const getIncludeMetadata = (context: IExecuteFunctions, itemIndex: number): boolean =>
  context.getNodeParameter("includePlugMetadata", itemIndex, true) as boolean;

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

const toNodeItems = (jsonItems: IDataObject[]): INodeExecutionData[] =>
  jsonItems.map((json) => ({ json }));

const buildListClientAgentsResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const status = toStatusFilter<ClientAgentStatus>(
    context.getNodeParameter("status", itemIndex, "all"),
    ["active", "inactive"],
    "Agent Status",
  );
  const search = toOptionalString(context.getNodeParameter("search", itemIndex, ""));
  const page = toPositiveInteger(context.getNodeParameter("page", itemIndex, 1), "Page");
  const pageSize = toPositiveInteger(
    context.getNodeParameter("pageSize", itemIndex, 50),
    "Page Size",
  );
  const returnAll = context.getNodeParameter("returnAll", itemIndex, false) as boolean;
  const refresh = context.getNodeParameter("refresh", itemIndex, false) as boolean;

  const response = await sessionRunner((session) => {
    const initialQuery = {
      status,
      search,
      page,
      pageSize,
      refresh,
    };

    if (!returnAll) {
      return listClientAgents(requester, session, initialQuery);
    }

    return collectAllPages({
      initialQuery,
      fetchPage: (query) => listClientAgents(requester, session, query),
      toEnvelope: (pageResponse) => ({
        items: pageResponse.agents,
        total: pageResponse.total,
        page: pageResponse.page,
        pageSize: pageResponse.pageSize,
      }),
      buildAggregatedResponse: (items, firstResponse) => ({
        ...firstResponse,
        agents: items,
        agentIds: items.map((item) => item.agentId),
        count: items.length,
        total: firstResponse.total,
        page: 1,
        pageSize: items.length,
      }),
    });
  });

  return {
    operation: "listClientAgents",
    response,
  };
};

const buildGetClientAgentResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const agentId = toOptionalString(context.getNodeParameter("agentId", itemIndex, ""));
  if (!agentId) {
    throw new PlugValidationError("Agent ID is required");
  }

  const response = await sessionRunner((session) =>
    getClientAgent(requester, session, agentId),
  );
  return {
    operation: "getClientAgent",
    response,
  };
};

const buildListAccessRequestsResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const status = toStatusFilter<ClientAccessRequestStatus>(
    context.getNodeParameter("status", itemIndex, "all"),
    ["pending", "approved", "rejected", "expired", "revoked"],
    "Request Status",
  );
  const search = toOptionalString(context.getNodeParameter("search", itemIndex, ""));
  const page = toPositiveInteger(context.getNodeParameter("page", itemIndex, 1), "Page");
  const pageSize = toPositiveInteger(
    context.getNodeParameter("pageSize", itemIndex, 50),
    "Page Size",
  );
  const returnAll = context.getNodeParameter("returnAll", itemIndex, false) as boolean;

  const response = await sessionRunner((session) => {
    const initialQuery = {
      status,
      search,
      page,
      pageSize,
    };

    if (!returnAll) {
      return listClientAccessRequests(requester, session, initialQuery);
    }

    return collectAllPages({
      initialQuery,
      fetchPage: (query) => listClientAccessRequests(requester, session, query),
      toEnvelope: (pageResponse) => ({
        items: pageResponse.items,
        total: pageResponse.total,
        page: pageResponse.page,
        pageSize: pageResponse.pageSize,
      }),
      buildAggregatedResponse: (items, firstResponse) => ({
        ...firstResponse,
        items,
        total: firstResponse.total,
        page: 1,
        pageSize: items.length,
      }),
    });
  });

  return {
    operation: "listAccessRequests",
    response,
  };
};

const buildRequestAgentAccessResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const agentIds = parseStringListCollection(
    context.getNodeParameter("agentIds", itemIndex),
    "Agent IDs",
    "agentId",
  );
  if (agentIds.length === 0) {
    throw new PlugValidationError("Agent IDs must contain at least one agent ID");
  }

  const response = await sessionRunner((session) =>
    requestClientAgentAccess(requester, session, {
      agentIds,
    }),
  );

  return {
    operation: "requestAgentAccess",
    response,
  };
};

const buildRevokeAgentAccessResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const revokeMode = context.getNodeParameter("revokeMode", itemIndex, "single") as
    | "single"
    | "batch";
  const agentId = toOptionalString(
    context.getNodeParameter("revokeAgentId", itemIndex, ""),
  );
  const agentIds =
    revokeMode === "batch"
      ? parseStringListCollection(
          context.getNodeParameter("revokeAgentIds", itemIndex),
          "Agent IDs",
          "agentId",
        )
      : undefined;

  if (revokeMode === "single" && !agentId) {
    throw new PlugValidationError("Agent ID is required for single-agent revoke");
  }

  if (revokeMode === "batch" && (!agentIds || agentIds.length === 0)) {
    throw new PlugValidationError("Agent IDs must contain at least one agent ID");
  }

  const response = await sessionRunner((session) =>
    revokeClientAgentAccess(requester, session, {
      ...(revokeMode === "single" ? { agentId } : { agentIds }),
    }),
  );

  return {
    operation: "revokeAgentAccess",
    response,
  };
};

const buildGetClientTokenResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const agentId = toOptionalString(context.getNodeParameter("agentId", itemIndex, ""));
  if (!agentId) {
    throw new PlugValidationError("Agent ID is required");
  }

  const response = await sessionRunner((session) =>
    getClientAgentToken(requester, session, agentId),
  );

  return {
    operation: "getClientToken",
    response,
  };
};

const buildSetClientTokenResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const agentId = toOptionalString(context.getNodeParameter("agentId", itemIndex, ""));
  const clearStoredClientToken = context.getNodeParameter(
    "clearStoredClientToken",
    itemIndex,
    false,
  ) as boolean;
  const clientToken = toOptionalString(
    context.getNodeParameter("clientToken", itemIndex, ""),
  );

  if (!agentId) {
    throw new PlugValidationError("Agent ID is required");
  }

  if (!clearStoredClientToken && !clientToken) {
    throw new PlugValidationError(
      "Client Token is required unless Clear Stored Client Token is enabled",
    );
  }

  const response = await sessionRunner((session) =>
    setClientAgentToken(requester, session, {
      agentId,
      clientToken: clearStoredClientToken ? null : (clientToken ?? null),
    }),
  );

  return {
    operation: "setClientToken",
    response,
  };
};

const buildExecutionResult = async (
  requester: import("../contracts/api").PlugHttpRequester,
  sessionRunner: ReturnType<
    typeof createExecutionSessionRunner<PlugClientAuthCredentials>
  >,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<ClientAccessExecutionResult> => {
  const operation = context.getNodeParameter(
    "operation",
    itemIndex,
  ) as ClientAccessOperation;

  switch (operation) {
    case "listClientAgents":
      return buildListClientAgentsResult(requester, sessionRunner, context, itemIndex);
    case "getClientAgent":
      return buildGetClientAgentResult(requester, sessionRunner, context, itemIndex);
    case "listAccessRequests":
      return buildListAccessRequestsResult(requester, sessionRunner, context, itemIndex);
    case "requestAgentAccess":
      return buildRequestAgentAccessResult(requester, sessionRunner, context, itemIndex);
    case "revokeAgentAccess":
      return buildRevokeAgentAccessResult(requester, sessionRunner, context, itemIndex);
    case "getClientToken":
      return buildGetClientTokenResult(requester, sessionRunner, context, itemIndex);
    case "setClientToken":
      return buildSetClientTokenResult(requester, sessionRunner, context, itemIndex);
    default: {
      const exhaustiveCheck: never = operation;
      throw new PlugValidationError(
        `Unsupported client access operation: ${exhaustiveCheck}`,
      );
    }
  }
};

export const executePlugClientAccessNode = async (
  context: IExecuteFunctions,
  config: PlugClientAccessNodeExecutionConfig,
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
      const executionResult = await buildExecutionResult(
        requester,
        sessionRunner,
        context,
        itemIndex,
      );
      const jsonItems = buildClientAccessOutputItems(
        executionResult,
        getIncludeMetadata(context, itemIndex),
      );

      outputItems.push(...toNodeItems(jsonItems as IDataObject[]));
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
            : new Error(
                `Unknown ${config.nodeDisplayName ?? "Plug Client Access"} error`,
              );

      throw new NodeOperationError(context.getNode(), nodeError, {
        itemIndex,
      });
    }
  }

  return [outputItems];
};
