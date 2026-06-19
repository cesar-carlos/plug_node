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
  OwnedClientDetailResponse,
  OwnedClientListResponse,
  OwnedClientRecord,
  OwnedClientRegistrationDecisionResponse,
  OwnedClientStatus,
  PaginatedAgentCatalogResponse,
  UserAccessMutationSummary,
} from "../contracts/user-access";
import { requestAuthorizedJson } from "./resourceClient";
import {
  assertRecord,
  assertRecordArray,
  assertString,
  assertNumber,
} from "./parseHelpers";

const agentCatalogPath = "/agents/catalog";
const managedAccessRequestsPath = "/me/client-access-requests";
const ownedClientsPath = "/me/clients";
const ownedAgentsPath = "/me/agents";

interface ListAgentCatalogInput {
  readonly status?: "active" | "inactive";
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

interface ListManagedAccessRequestsInput {
  readonly page?: number;
  readonly pageSize?: number;
}

interface ListOwnedClientsInput {
  readonly status?: OwnedClientStatus;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

interface SetOwnedClientStatusInput {
  readonly clientId: string;
  readonly status: "active" | "blocked";
}

interface RejectOwnedClientRegistrationInput {
  readonly clientId: string;
  readonly reason?: string;
}

const parseAgentCatalogResponse = (body: unknown): PaginatedAgentCatalogResponse => {
  const record = assertRecord(body, "Agent catalog response");

  return {
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

const parseOwnedClientListResponse = (body: unknown): OwnedClientListResponse => {
  const record = assertRecord(body, "Owned clients response");

  return {
    clients: assertRecordArray<OwnedClientRecord>(record.clients, "clients"),
    count: assertNumber(record.count, "count"),
    total: assertNumber(record.total, "total"),
    page: assertNumber(record.page, "page"),
    pageSize: assertNumber(record.pageSize, "pageSize"),
  };
};

const parseOwnedClientDetailResponse = (body: unknown): OwnedClientDetailResponse => {
  const record = assertRecord(body, "Owned client response");

  return {
    client: assertRecord(record.client, "client") as OwnedClientRecord,
  };
};

const parseOwnedClientRegistrationDecisionResponse = (
  body: unknown,
): OwnedClientRegistrationDecisionResponse => {
  const record = assertRecord(body, "Owned client registration decision response");

  return {
    ...(typeof record.approved === "boolean" ? { approved: record.approved } : {}),
    ...(typeof record.rejected === "boolean" ? { rejected: record.rejected } : {}),
    ...(typeof record.clientEmail === "string"
      ? { clientEmail: record.clientEmail }
      : {}),
  };
};

export const listAgentCatalog = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  input: ListAgentCatalogInput,
): Promise<PaginatedAgentCatalogResponse> => {
  const body = await requestAuthorizedJson(requester, session, {
    method: "GET",
    path: agentCatalogPath,
    query: {
      status: input.status,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    },
  });

  return parseAgentCatalogResponse(body);
};

export const listManagedAccessRequests = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  input: ListManagedAccessRequestsInput = {},
): Promise<ManagedAccessRequestListResponse> => {
  const body = await requestAuthorizedJson(requester, session, {
    method: "GET",
    path: managedAccessRequestsPath,
    query: {
      page: input.page,
      pageSize: input.pageSize,
    },
  });

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
  const raw = await requestAuthorizedJson(requester, session, {
    method: "POST",
    path: `${managedAccessRequestsPath}/${encodeURIComponent(requestId)}/approve`,
    acceptedStatusCodes: [200, 204],
  });

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
  const raw = await requestAuthorizedJson(requester, session, {
    method: "POST",
    path: `${managedAccessRequestsPath}/${encodeURIComponent(requestId)}/reject`,
    acceptedStatusCodes: [200, 204],
  });

  return {
    resourceType: "accessRequest",
    resourceId: requestId,
    raw,
  };
};

export const listOwnedClients = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  input: ListOwnedClientsInput = {},
): Promise<OwnedClientListResponse> => {
  const body = await requestAuthorizedJson(requester, session, {
    method: "GET",
    path: ownedClientsPath,
    query: {
      status: input.status,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    },
  });

  return parseOwnedClientListResponse(body);
};

export const getOwnedClient = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  clientId: string,
): Promise<OwnedClientDetailResponse> => {
  const body = await requestAuthorizedJson(requester, session, {
    method: "GET",
    path: `${ownedClientsPath}/${encodeURIComponent(clientId)}`,
  });

  return parseOwnedClientDetailResponse(body);
};

export const setOwnedClientStatus = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  input: SetOwnedClientStatusInput,
): Promise<OwnedClientDetailResponse> => {
  const body = await requestAuthorizedJson(requester, session, {
    method: "PATCH",
    path: `${ownedClientsPath}/${encodeURIComponent(input.clientId)}/status`,
    body: {
      status: input.status,
    },
  });

  return parseOwnedClientDetailResponse(body);
};

export const approveOwnedClientRegistration = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  clientId: string,
): Promise<UserAccessMutationSummary> => {
  const raw = await requestAuthorizedJson(requester, session, {
    method: "POST",
    path: `${ownedClientsPath}/${encodeURIComponent(clientId)}/registration/approve`,
    acceptedStatusCodes: [200, 204],
  });

  const parsed = parseOwnedClientRegistrationDecisionResponse(raw);

  return {
    resourceType: "ownedClientGovernance",
    resourceId: assertString(clientId, "clientId"),
    raw: parsed,
  };
};

export const rejectOwnedClientRegistration = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  input: RejectOwnedClientRegistrationInput,
): Promise<UserAccessMutationSummary> => {
  const raw = await requestAuthorizedJson(requester, session, {
    method: "POST",
    path: `${ownedClientsPath}/${encodeURIComponent(input.clientId)}/registration/reject`,
    body: input.reason ? { reason: input.reason } : undefined,
    acceptedStatusCodes: [200, 204],
  });

  const parsed = parseOwnedClientRegistrationDecisionResponse(raw);

  return {
    resourceType: "ownedClientGovernance",
    resourceId: assertString(input.clientId, "clientId"),
    raw: parsed,
  };
};

export const listAgentClients = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugUserAuthCredentials, PlugUserLoginResponse>,
  agentId: string,
): Promise<AgentClientListResponse> => {
  const body = await requestAuthorizedJson(requester, session, {
    method: "GET",
    path: `${ownedAgentsPath}/${encodeURIComponent(agentId)}/clients`,
  });

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
  const raw = await requestAuthorizedJson(requester, session, {
    method: "DELETE",
    path: `${ownedAgentsPath}/${encodeURIComponent(agentId)}/clients/${encodeURIComponent(clientId)}`,
    acceptedStatusCodes: [200, 204],
  });

  return {
    resourceType: "agentClientAccess",
    resourceId: assertString(clientId, "clientId"),
    agentId,
    raw,
  };
};
