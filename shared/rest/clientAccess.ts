import type {
  PlugAnyLoginResponse,
  PlugEmailPasswordCredentials,
  PlugClientAuthCredentials,
  PlugHttpRequester,
  PlugSession,
} from "../contracts/api";
import type {
  ClientAccessibleAgent,
  ClientAgentAccessRequestRecord,
  ClientAgentStatus,
  ClientAccessRequestStatus,
  ClientAgentTokenResponse,
  GetClientAgentResponse,
  ListClientAccessRequestsResponse,
  ListClientAgentsResponse,
  RequestAgentAccessResponse,
  RevokeAgentAccessSummary,
} from "../contracts/client-access";
import { PlugValidationError } from "../contracts/errors";
import { isRecord } from "../utils/json";
import { requestAuthorizedJson } from "./resourceClient";
import {
  assertOptionalString,
  assertRecord,
  assertRecordArray,
  assertString,
  assertStringArray,
  assertNumber,
} from "./parseHelpers";

const clientAgentsPath = "/client/me/agents";
const clientAccessRequestsPath = "/client/me/agent-access-requests";

interface ListClientAgentsInput {
  readonly status?: ClientAgentStatus;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
  readonly refresh?: boolean;
}

interface ListClientAccessRequestsInput {
  readonly status?: ClientAccessRequestStatus;
  readonly search?: string;
  readonly page?: number;
  readonly pageSize?: number;
}

interface RequestClientAgentAccessInput {
  readonly agentIds: string[];
}

interface RevokeClientAgentAccessInput {
  readonly agentId?: string;
  readonly agentIds?: string[];
}

interface SetClientAgentTokenInput {
  readonly agentId: string;
  readonly clientToken: string | null;
}

const requestClientAccessResource = async <
  TBody = unknown,
  TCredentials extends PlugEmailPasswordCredentials = PlugClientAuthCredentials,
  TLoginResponse extends PlugAnyLoginResponse = PlugAnyLoginResponse,
>(
  requester: PlugHttpRequester,
  session: PlugSession<TCredentials, TLoginResponse>,
  options: {
    readonly method: "GET" | "POST" | "PUT" | "DELETE";
    readonly path: string;
    readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
    readonly body?: unknown;
    readonly timeoutMs?: number;
    readonly acceptedStatusCodes?: number[];
  },
): Promise<TBody> =>
  requestAuthorizedJson<TBody, TCredentials, TLoginResponse>(requester, session, options);

const parseListClientAgentsResponse = (body: unknown): ListClientAgentsResponse => {
  const record = assertRecord(body, "List client agents response");

  return {
    agents: assertRecordArray<ClientAccessibleAgent>(record.agents, "agents"),
    agentIds: assertStringArray(record.agentIds, "agentIds"),
    count: assertNumber(record.count, "count"),
    total: assertNumber(record.total, "total"),
    page: assertNumber(record.page, "page"),
    pageSize: assertNumber(record.pageSize, "pageSize"),
  };
};

const parseGetClientAgentResponse = (body: unknown): GetClientAgentResponse => {
  const record = assertRecord(body, "Get client agent response");

  return {
    agent: assertRecord(record.agent, "agent") as ClientAccessibleAgent,
  };
};

const parseListAccessRequestsResponse = (
  body: unknown,
): ListClientAccessRequestsResponse => {
  const record = assertRecord(body, "List access requests response");

  return {
    items: assertRecordArray<ClientAgentAccessRequestRecord>(record.items, "items"),
    total: assertNumber(record.total, "total"),
    page: assertNumber(record.page, "page"),
    pageSize: assertNumber(record.pageSize, "pageSize"),
  };
};

const parseRequestAgentAccessResponse = (body: unknown): RequestAgentAccessResponse => {
  const record = assertRecord(body, "Request agent access response");

  return {
    requested: assertStringArray(record.requested, "requested"),
    alreadyApproved: assertStringArray(record.alreadyApproved, "alreadyApproved"),
    newRequests: assertStringArray(record.newRequests, "newRequests"),
    reopened: assertStringArray(record.reopened, "reopened"),
    debounced: assertStringArray(record.debounced, "debounced"),
  };
};

const parseClientAgentTokenResponse = (body: unknown): ClientAgentTokenResponse => {
  const record = assertRecord(body, "Client token response");
  const clientToken = assertOptionalString(record.clientToken);

  if (clientToken === undefined) {
    throw new PlugValidationError("clientToken must be a string or null");
  }

  return {
    agentId: assertString(record.agentId, "agentId"),
    clientToken,
  };
};

export const listClientAgents = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  input: ListClientAgentsInput,
): Promise<ListClientAgentsResponse> => {
  const body = await requestClientAccessResource(requester, session, {
    method: "GET",
    path: clientAgentsPath,
    query: {
      status: input.status,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
      refresh: input.refresh,
    },
  });

  return parseListClientAgentsResponse(body);
};

export const getClientAgent = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  agentId: string,
): Promise<GetClientAgentResponse> => {
  const body = await requestClientAccessResource(requester, session, {
    method: "GET",
    path: `${clientAgentsPath}/${encodeURIComponent(agentId)}`,
  });

  return parseGetClientAgentResponse(body);
};

export const listClientAccessRequests = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  input: ListClientAccessRequestsInput,
): Promise<ListClientAccessRequestsResponse> => {
  const body = await requestClientAccessResource(requester, session, {
    method: "GET",
    path: clientAccessRequestsPath,
    query: {
      status: input.status,
      search: input.search,
      page: input.page,
      pageSize: input.pageSize,
    },
  });

  return parseListAccessRequestsResponse(body);
};

export const requestClientAgentAccess = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  input: RequestClientAgentAccessInput,
): Promise<RequestAgentAccessResponse> => {
  const body = await requestClientAccessResource(requester, session, {
    method: "POST",
    path: clientAgentsPath,
    body: {
      agentIds: input.agentIds,
    },
  });

  return parseRequestAgentAccessResponse(body);
};

export const revokeClientAgentAccess = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  input: RevokeClientAgentAccessInput,
): Promise<RevokeAgentAccessSummary> => {
  const singleAgentId = input.agentId?.trim();
  const isRevokeSingle =
    Boolean(singleAgentId) && (!input.agentIds || input.agentIds.length === 0);

  const body = isRevokeSingle
    ? await requestClientAccessResource(requester, session, {
        method: "DELETE",
        path: `${clientAgentsPath}/${encodeURIComponent(singleAgentId as string)}`,
      })
    : await requestClientAccessResource(requester, session, {
        method: "DELETE",
        path: clientAgentsPath,
        body: {
          agentIds: input.agentIds,
        },
      });

  return {
    revokeMode: isRevokeSingle ? "single" : "batch",
    ...(isRevokeSingle
      ? {
          agentId: singleAgentId as string,
          revokedCount: 1,
        }
      : {
          agentIds: input.agentIds,
          revokedCount: input.agentIds?.length ?? 0,
        }),
    ...(body !== undefined ? { response: body } : {}),
  };
};

export const getClientAgentToken = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  agentId: string,
): Promise<ClientAgentTokenResponse> => {
  const body = await requestClientAccessResource(requester, session, {
    method: "GET",
    path: `${clientAgentsPath}/${encodeURIComponent(agentId)}/client-token`,
  });

  return parseClientAgentTokenResponse(body);
};

export const setClientAgentToken = async (
  requester: PlugHttpRequester,
  session: PlugSession<PlugClientAuthCredentials>,
  input: SetClientAgentTokenInput,
): Promise<ClientAgentTokenResponse> => {
  const body = await requestClientAccessResource(requester, session, {
    method: "PUT",
    path: `${clientAgentsPath}/${encodeURIComponent(input.agentId)}/client-token`,
    body: {
      clientToken: input.clientToken,
    },
  });

  return parseClientAgentTokenResponse(body);
};

export const isClientAccessibleAgent = (value: unknown): value is ClientAccessibleAgent =>
  isRecord(value) &&
  typeof value.agentId === "string" &&
  typeof value.name === "string" &&
  typeof value.status === "string" &&
  typeof value.isHubConnected === "boolean";
