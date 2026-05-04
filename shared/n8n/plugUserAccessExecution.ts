import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
} from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import type { PlugUserAuthCredentials } from "../contracts/api";
import type {
  UserAccessExecutionResult,
  UserAccessOperation,
} from "../contracts/user-access";
import { DEFAULT_BASE_URL } from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";
import { createUserExecutionSessionRunner } from "../auth/session";
import { buildUserAccessOutputItems } from "../output/userAccessOutput";
import { collectAllPages } from "../rest/resourceClient";
import {
  approveAccessRequest,
  listAgentCatalog,
  listAgentClients,
  listManagedAccessRequests,
  rejectAccessRequest,
  revokeAgentClientAccess,
} from "../rest/userAccess";
import { isRecord } from "../utils/json";

export interface PlugUserAccessNodeExecutionConfig {
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
  config: PlugUserAccessNodeExecutionConfig,
): Promise<PlugUserAuthCredentials> => {
  const rawCredentials = await context.getCredentials(
    config.credentialName ?? "plugDatabaseUserApi",
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
  requester: import("../contracts/api").PlugHttpRequester,
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
      const page = toPositiveInteger(
        context.getNodeParameter("page", itemIndex, 1),
        "Page",
      );
      const pageSize = toPositiveInteger(
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
      const response = await sessionRunner((session) =>
        listManagedAccessRequests(requester, session),
      );
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
  const sourceItems = context.getInputData();
  const items =
    sourceItems.length > 0 ? sourceItems : [{ json: {} } as INodeExecutionData];
  const credentials = await readCredentials(context, config);
  const requester = buildHttpRequester(context);
  const sessionRunner = createUserExecutionSessionRunner(requester, credentials);
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const executionResult = await buildExecutionResult(
        requester,
        sessionRunner,
        context,
        itemIndex,
      );
      const jsonItems = buildUserAccessOutputItems(
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
            : new Error(`Unknown ${config.nodeDisplayName ?? "Plug User Access"} error`);

      throw new NodeOperationError(context.getNode(), nodeError, {
        itemIndex,
      });
    }
  }

  return [outputItems];
};
