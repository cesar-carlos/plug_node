import type { JsonObject } from "../contracts/api";
import type {
  UserAccessExecutionResult,
  UserAccessMetadata,
} from "../contracts/user-access";

const withMetadata = (
  value: JsonObject,
  metadata: UserAccessMetadata,
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
  metadata: UserAccessMetadata,
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

export const buildUserAccessOutputItems = (
  result: UserAccessExecutionResult,
  includeMetadata = true,
): JsonObject[] => {
  switch (result.operation) {
    case "listAgentCatalog":
      return result.response.agents.map((agent, itemIndex) =>
        withMetadata(
          agent,
          {
            operation: "listAgentCatalog",
            kind: "list",
            itemIndex,
            total: result.response.total,
            page: result.response.page,
            pageSize: result.response.pageSize,
          },
          includeMetadata,
        ),
      );
    case "listManagedAccessRequests":
      return result.response.items.map((item, itemIndex) =>
        withMetadata(
          item,
          {
            operation: "listManagedAccessRequests",
            kind: "list",
            itemIndex,
            total: result.response.total,
            page: result.response.page,
            pageSize: result.response.pageSize,
          },
          includeMetadata,
        ),
      );
    case "listAgentClients":
      return result.response.items.map((item, itemIndex) =>
        withMetadata(
          item,
          {
            operation: "listAgentClients",
            kind: "list",
            itemIndex,
            total: result.response.total,
            page: result.response.page,
            pageSize: result.response.pageSize,
          },
          includeMetadata,
        ),
      );
    case "approveAccessRequest":
    case "rejectAccessRequest":
    case "revokeAgentClientAccess":
      return [
        buildSummaryEnvelope(
          result.response,
          {
            operation: result.operation,
            kind: "summary",
          },
          includeMetadata,
        ),
      ];
    default: {
      const exhaustiveCheck: never = result;
      throw new Error(
        `Unsupported user access output result: ${String(exhaustiveCheck)}`,
      );
    }
  }
};
