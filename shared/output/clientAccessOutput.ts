import type { JsonObject } from "../contracts/api";
import type {
  ClientAccessExecutionResult,
  ClientAccessMetadata,
  ClientAgentTokenResponse,
  GetClientAgentResponse,
  ListClientAccessRequestsResponse,
  ListClientAgentsResponse,
  RequestAgentAccessResponse,
  RevokeAgentAccessSummary,
} from "../contracts/client-access";

const withMetadata = (
  value: JsonObject,
  metadata: ClientAccessMetadata,
  includeMetadata: boolean,
): JsonObject => {
  if (!includeMetadata) {
    return value;
  }

  return {
    ...value,
    __plug: metadata,
  };
};

const buildSummaryEnvelope = (
  summary: JsonObject,
  metadata: ClientAccessMetadata,
  includeMetadata: boolean,
): JsonObject =>
  withMetadata(
    {
      success: true,
      operation: metadata.operation,
      ...summary,
    },
    metadata,
    includeMetadata,
  );

const toAgentItems = (
  response: ListClientAgentsResponse,
  operation: ClientAccessExecutionResult["operation"],
  includeMetadata: boolean,
): JsonObject[] =>
  response.agents.map((agent, index) =>
    withMetadata(
      agent,
      {
        operation,
        kind: "list",
        itemIndex: index,
        total: response.total,
        page: response.page,
        pageSize: response.pageSize,
      },
      includeMetadata,
    ),
  );

const toAccessRequestItems = (
  response: ListClientAccessRequestsResponse,
  includeMetadata: boolean,
): JsonObject[] =>
  response.items.map((item, index) =>
    withMetadata(
      item,
      {
        operation: "listAccessRequests",
        kind: "list",
        itemIndex: index,
        total: response.total,
        page: response.page,
        pageSize: response.pageSize,
      },
      includeMetadata,
    ),
  );

const toDetailItem = (
  response: GetClientAgentResponse,
  includeMetadata: boolean,
): JsonObject[] => [
  withMetadata(
    response.agent,
    {
      operation: "getClientAgent",
      kind: "detail",
    },
    includeMetadata,
  ),
];

const toTokenItem = (
  operation: "getClientToken" | "setClientToken",
  response: ClientAgentTokenResponse,
  includeMetadata: boolean,
): JsonObject[] => [
  buildSummaryEnvelope(
    {
      ...response,
      resourceType: "clientAgentToken",
      resourceId: response.agentId,
      raw: response,
      hasClientToken: response.clientToken !== null,
      cleared: response.clientToken === null,
    },
    {
      operation,
      kind: "summary",
    },
    includeMetadata,
  ),
];

const toRequestAccessItem = (
  response: RequestAgentAccessResponse,
  includeMetadata: boolean,
): JsonObject[] => [
  buildSummaryEnvelope(
    {
      resourceType: "clientAgentAccessRequest",
      resourceIds: response.requested,
      raw: response,
      ...response,
    },
    {
      operation: "requestAgentAccess",
      kind: "summary",
    },
    includeMetadata,
  ),
];

const toRevokeAccessItem = (
  response: RevokeAgentAccessSummary,
  includeMetadata: boolean,
): JsonObject[] => [
  buildSummaryEnvelope(
    {
      resourceType: "clientAgentAccess",
      ...(response.agentId ? { resourceId: response.agentId } : {}),
      ...(response.agentIds ? { resourceIds: response.agentIds } : {}),
      raw: response.response ?? response,
      ...response,
    },
    {
      operation: "revokeAgentAccess",
      kind: "summary",
    },
    includeMetadata,
  ),
];

export const buildClientAccessOutputItems = (
  result: ClientAccessExecutionResult,
  includeMetadata = true,
): JsonObject[] => {
  switch (result.operation) {
    case "listClientAgents":
      return toAgentItems(result.response, result.operation, includeMetadata);
    case "getClientAgent":
      return toDetailItem(result.response, includeMetadata);
    case "listAccessRequests":
      return toAccessRequestItems(result.response, includeMetadata);
    case "requestAgentAccess":
      return toRequestAccessItem(result.response, includeMetadata);
    case "revokeAgentAccess":
      return toRevokeAccessItem(result.response, includeMetadata);
    case "getClientToken":
    case "setClientToken":
      return toTokenItem(result.operation, result.response, includeMetadata);
    default: {
      const exhaustiveCheck: never = result;
      throw new Error(
        `Unsupported client access output result: ${String(exhaustiveCheck)}`,
      );
    }
  }
};
