import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import type { PlugClientAuthCredentials, PlugHttpRequester } from "../contracts/api";
import type {
  ClientAccessExecutionResult,
  ClientAccessOperation,
  ClientAccessRequestStatus,
  ClientAgentStatus,
} from "../contracts/client-access";
import { PlugValidationError } from "../contracts/errors";
import { createExecutionSessionRunner } from "../auth/session";
import { buildClientAccessOutputItems } from "../output/clientAccessOutput";
import { executeWithPlugTransientRetry } from "./plugTransientRetry";
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
import { parseStringListCollection } from "../utils/json";
import { buildN8nHttpRequester } from "./httpRequester";
import { readPlugEmailPasswordCredentials } from "./plugCommandRequestBuilder";
import { toOptionalPositiveInteger, toOptionalString } from "./plugExecutionParameters";
import { executePerInputItem, toAccessNodeOperationError } from "./plugItemExecution";

export interface PlugClientAccessNodeExecutionConfig {
  readonly credentialName?: string;
  readonly nodeDisplayName?: string;
}

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

const getIncludeMetadata = (context: IExecuteFunctions, itemIndex: number): boolean =>
  context.getNodeParameter("includePlugMetadata", itemIndex, true) as boolean;

const toNodeItems = (jsonItems: IDataObject[]): INodeExecutionData[] =>
  jsonItems.map((json) => ({ json }));

const buildListClientAgentsResult = async (
  requester: PlugHttpRequester,
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
  const page = toOptionalPositiveInteger(
    context.getNodeParameter("page", itemIndex, 1),
    "Page",
  );
  const pageSize = toOptionalPositiveInteger(
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
  requester: PlugHttpRequester,
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
  requester: PlugHttpRequester,
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
  const page = toOptionalPositiveInteger(
    context.getNodeParameter("page", itemIndex, 1),
    "Page",
  );
  const pageSize = toOptionalPositiveInteger(
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
  requester: PlugHttpRequester,
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
  requester: PlugHttpRequester,
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
  requester: PlugHttpRequester,
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
  requester: PlugHttpRequester,
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
  requester: PlugHttpRequester,
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
  const credentials = await readPlugEmailPasswordCredentials(
    context,
    config.credentialName ?? "plugDatabaseAccountApi",
  );
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createExecutionSessionRunner(requester, credentials);
  const nodeDisplayName = config.nodeDisplayName ?? "Plug Client Access";

  return executePerInputItem(
    context,
    async (itemIndex) => {
      const { value: executionResult } = await executeWithPlugTransientRetry({
        execute: () => buildExecutionResult(requester, sessionRunner, context, itemIndex),
      });
      const jsonItems = buildClientAccessOutputItems(
        executionResult,
        getIncludeMetadata(context, itemIndex),
      );

      return toNodeItems(jsonItems as IDataObject[]);
    },
    {
      onError: (error, itemIndex) =>
        toAccessNodeOperationError(context, error, itemIndex, nodeDisplayName),
    },
  );
};
