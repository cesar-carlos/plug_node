import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import type { PlugHttpRequester } from "../contracts/api";
import type {
  UserAccessExecutionResult,
  UserAccessOperation,
} from "../contracts/user-access";
import { PlugValidationError } from "../contracts/errors";
import { createUserExecutionSessionRunner } from "../auth/session";
import { buildUserAccessOutputItems } from "../output/userAccessOutput";
import { executeWithPlugTransientRetry } from "./plugTransientRetry";
import { collectAllPages } from "../rest/resourceClient";
import {
  approveAccessRequest,
  listAgentCatalog,
  listAgentClients,
  listManagedAccessRequests,
  rejectAccessRequest,
  revokeAgentClientAccess,
} from "../rest/userAccess";
import { buildN8nHttpRequester } from "./httpRequester";
import { readPlugEmailPasswordCredentials } from "./plugCommandRequestBuilder";
import { toOptionalPositiveInteger, toOptionalString } from "./plugExecutionParameters";
import { executePerInputItem, toAccessNodeOperationError } from "./plugItemExecution";

export interface PlugUserAccessNodeExecutionConfig {
  readonly credentialName?: string;
  readonly nodeDisplayName?: string;
}

const getIncludeMetadata = (context: IExecuteFunctions, itemIndex: number): boolean =>
  context.getNodeParameter("includePlugMetadata", itemIndex, true) as boolean;

const toNodeItems = (jsonItems: IDataObject[]): INodeExecutionData[] =>
  jsonItems.map((json) => ({ json }));

const requireStringParameter = (
  context: IExecuteFunctions,
  itemIndex: number,
  name: string,
  label: string,
): string => {
  const value = toOptionalString(context.getNodeParameter(name, itemIndex, ""));
  if (!value) {
    throw new PlugValidationError(`${label} is required`);
  }

  return value;
};

const buildExecutionResult = async (
  requester: PlugHttpRequester,
  sessionRunner: ReturnType<typeof createUserExecutionSessionRunner>,
  context: IExecuteFunctions,
  itemIndex: number,
): Promise<UserAccessExecutionResult> => {
  const operation = context.getNodeParameter(
    "operation",
    itemIndex,
  ) as UserAccessOperation;

  switch (operation) {
    case "listAgentCatalog": {
      const status = context.getNodeParameter("status", itemIndex, "all") as
        | "all"
        | "active"
        | "inactive";
      const search = toOptionalString(context.getNodeParameter("search", itemIndex, ""));
      const page = toOptionalPositiveInteger(
        context.getNodeParameter("page", itemIndex, 1),
        "Page",
      );
      const pageSize = toOptionalPositiveInteger(
        context.getNodeParameter("pageSize", itemIndex, 50),
        "Page Size",
      );
      const returnAll = context.getNodeParameter(
        "returnAll",
        itemIndex,
        false,
      ) as boolean;

      const response = await sessionRunner((session) => {
        const initialQuery = {
          status: status === "all" ? undefined : status,
          search,
          page,
          pageSize,
        };

        if (!returnAll) {
          return listAgentCatalog(requester, session, initialQuery);
        }

        return collectAllPages({
          initialQuery,
          fetchPage: (query) => listAgentCatalog(requester, session, query),
          toEnvelope: (pageResponse) => ({
            items: pageResponse.agents,
            total: pageResponse.total,
            page: pageResponse.page,
            pageSize: pageResponse.pageSize,
          }),
          buildAggregatedResponse: (items, firstResponse) => ({
            ...firstResponse,
            agents: items,
            count: items.length,
            total: firstResponse.total,
            page: 1,
            pageSize: items.length,
          }),
        });
      });

      return {
        operation,
        response,
      };
    }
    case "listManagedAccessRequests": {
      const page = toOptionalPositiveInteger(
        context.getNodeParameter("page", itemIndex, 1),
        "Page",
      );
      const pageSize = toOptionalPositiveInteger(
        context.getNodeParameter("pageSize", itemIndex, 50),
        "Page Size",
      );
      const returnAll = context.getNodeParameter(
        "returnAll",
        itemIndex,
        false,
      ) as boolean;

      const response = await sessionRunner((session) => {
        const initialQuery = {
          page,
          pageSize,
        };

        if (!returnAll) {
          return listManagedAccessRequests(requester, session, initialQuery);
        }

        return collectAllPages({
          initialQuery,
          fetchPage: (query) => listManagedAccessRequests(requester, session, query),
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
        operation,
        response,
      };
    }
    case "approveAccessRequest": {
      const requestId = requireStringParameter(
        context,
        itemIndex,
        "requestId",
        "Request ID",
      );
      const response = await sessionRunner((session) =>
        approveAccessRequest(requester, session, requestId),
      );
      return {
        operation,
        response,
      };
    }
    case "rejectAccessRequest": {
      const requestId = requireStringParameter(
        context,
        itemIndex,
        "requestId",
        "Request ID",
      );
      const response = await sessionRunner((session) =>
        rejectAccessRequest(requester, session, requestId),
      );
      return {
        operation,
        response,
      };
    }
    case "listAgentClients": {
      const agentId = requireStringParameter(context, itemIndex, "agentId", "Agent ID");
      const response = await sessionRunner((session) =>
        listAgentClients(requester, session, agentId),
      );
      return {
        operation,
        response,
      };
    }
    case "revokeAgentClientAccess": {
      const agentId = requireStringParameter(context, itemIndex, "agentId", "Agent ID");
      const clientId = requireStringParameter(
        context,
        itemIndex,
        "clientId",
        "Client ID",
      );
      const response = await sessionRunner((session) =>
        revokeAgentClientAccess(requester, session, agentId, clientId),
      );
      return {
        operation,
        response,
      };
    }
    default: {
      const exhaustiveCheck: never = operation;
      throw new PlugValidationError(
        `Unsupported user access operation: ${exhaustiveCheck}`,
      );
    }
  }
};

export const executePlugUserAccessNode = async (
  context: IExecuteFunctions,
  config: PlugUserAccessNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const credentials = await readPlugEmailPasswordCredentials(
    context,
    config.credentialName ?? "plugDatabaseAccountApi",
  );
  const requester = buildN8nHttpRequester(context);
  const sessionRunner = createUserExecutionSessionRunner(requester, credentials);
  const nodeDisplayName = config.nodeDisplayName ?? "Plug User Access";

  return executePerInputItem(
    context,
    async (itemIndex) => {
      const { value: executionResult } = await executeWithPlugTransientRetry({
        execute: () => buildExecutionResult(requester, sessionRunner, context, itemIndex),
      });
      const jsonItems = buildUserAccessOutputItems(
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
