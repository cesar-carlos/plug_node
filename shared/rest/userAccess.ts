import type {
  JsonObject,
  PlugHttpRequester,
  PlugSession,
  PlugUserAuthCredentials,
  PlugUserLoginResponse,
} from "../contracts/api";
import type {
  AgentCatalogRecord,
  AgentClientListResponse,
  AgentClientRecord,
  ManagedAccessRequestListResponse,
  ManagedAccessRequestRecord,
  PaginatedAgentCatalogResponse,
  UserAccessMutationSummary,
} from "../contracts/user-access";
import { PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";
import { requestAuthorizedJson } from "./resourceClient";

const agentCatalogPath = "/agents/catalog";
const managedAccessRequestsPath = "/me/client-access-requests";
const ownedAgentsPath = "/me/agents";

interface ListAgentCatalogInput {
  readonly status?: "active" | "inactive";
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

const assertRecord = (value: unknown, label: string): JsonObject => {
  if (!isRecord(value)) {
    throw new PlugValidationError(`${label} must be an object`);
  }

  return value;
};

const assertString = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlugValidationError(`${label} must be a non-empty string`);
  }

  return value;
};

const assertNumber = (value: unknown, label: string): number => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new PlugValidationError(`${label} must be a number`);
  }

  return value;
};

const assertRecordArray = <TRecord extends JsonObject>(
  value: unknown,
  label: string,
): TRecord[] => {
  if (!Array.isArray(value)) {
    throw new PlugValidationError(`${label} must be an array`);
  }

  return value.map((item, index) => assertRecord(item, `${label}[${index}]`) as TRecord);
};

const parseAgentCatalogResponse = (body: unknown): PaginatedAgentCatalogResponse => {
  const record = assertRecord(body, "Agent catalog response");

  return {
    ...record,
    agents: assertRecordArray<AgentCatalogRecord>(record.agents, "agents"),
    count: assertNumber(record.count, "count"),
    total: assertNumber(record.total, "total"),
    page: assertNumber(record.page, "page"),
    pageSize: assertNumber(record.pageSize, "pageSize"),
  };
};

const parseLooseListResponse = <TRecord extends JsonObject>(
  body: unknown,
  label: string,
  collectionKeys: readonly string[],
): {
  readonly items: TRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly raw: JsonObject | unknown[];
} => {
  if (Array.isArray(body)) {
    const items = assertRecordArray<TRecord>(body, label);
    return {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
      raw: body,
    };
  }

  const record = assertRecord(body, label);
  const collectionKey = collectionKeys.find((key) => Array.isArray(record[key]));
  const collection = collectionKey ? record[collectionKey] : record.items;
  const items = assertRecordArray<TRecord>(collection, `${label} items`);

  return {
    items,
    total:
      typeof record.total === "number"
        ? record.total
        : typeof record.count === "number"
          ? record.count
          : items.length,
    page: typeof record.page === "number" ? record.page : 1,
    pageSize: typeof record.pageSize === "number" ? record.pageSize : items.length,
    raw: record,
  };
};

export const listAgentCatalog = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  input: ListAgentCatalogInput,
): Promise<PaginatedAgentCatalogResponse> => {
  const body = await requestAuthorizedJson(
    requester,
    session,
    {
      method: "GET",
      path: agentCatalogPath,
      query: {
        status: input.status,
        search: input.search,
        page: input.page,
        pageSize: input.pageSize,
      },
    },
  );

  return parseAgentCatalogResponse(body);
};

export const listManagedAccessRequests = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
): Promise<ManagedAccessRequestListResponse> => {
  const body = await requestAuthorizedJson(
    requester,
    session,
    {
      method: "GET",
      path: managedAccessRequestsPath,
    },
  );

  const normalized = parseLooseListResponse<ManagedAccessRequestRecord>(
    body,
    "Managed access requests response",
    ["items", "requests", "data"],
  );

  return {
    items: normalized.items,
    total: normalized.total,
    page: normalized.page,
    pageSize: normalized.pageSize,
    raw: normalized.raw,
  };
};

export const approveAccessRequest = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  requestId: string,
): Promise<UserAccessMutationSummary> => {
  const raw = await requestAuthorizedJson(
    requester,
    session,
    {
      method: "POST",
      path: `${managedAccessRequestsPath}/${encodeURIComponent(requestId)}/approve`,
      acceptedStatusCodes: [200, 204],
    },
  );

  return {
    resourceType: "accessRequest",
    resourceId: requestId,
    raw,
  };
};

export const rejectAccessRequest = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  requestId: string,
): Promise<UserAccessMutationSummary> => {
  const raw = await requestAuthorizedJson(
    requester,
    session,
    {
      method: "POST",
      path: `${managedAccessRequestsPath}/${encodeURIComponent(requestId)}/reject`,
      acceptedStatusCodes: [200, 204],
    },
  );

  return {
    resourceType: "accessRequest",
    resourceId: requestId,
    raw,
  };
};

export const listAgentClients = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  agentId: string,
): Promise<AgentClientListResponse> => {
  const body = await requestAuthorizedJson(
    requester,
    session,
    {
      method: "GET",
      path: `${ownedAgentsPath}/${encodeURIComponent(agentId)}/clients`,
    },
  );

  const normalized = parseLooseListResponse<AgentClientRecord>(
    body,
    "Agent clients response",
    ["items", "clients", "data"],
  );

  return {
    items: normalized.items,
    total: normalized.total,
    page: normalized.page,
    pageSize: normalized.pageSize,
    raw: normalized.raw,
  };
};

export const revokeAgentClientAccess = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  agentId: string,
  clientId: string,
): Promise<UserAccessMutationSummary> => {
  const raw = await requestAuthorizedJson(
    requester,
    session,
    {
      method: "DELETE",
      path: `${ownedAgentsPath}/${encodeURIComponent(agentId)}/clients/${encodeURIComponent(clientId)}`,
      acceptedStatusCodes: [200, 204],
    },
  );

  return {
    resourceType: "agentClientAccess",
    resourceId: assertString(clientId, "clientId"),
    agentId,
    raw,
  };
};
