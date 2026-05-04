import type { JsonObject } from "./api";

export type ClientAccessOperation =
  | "listClientAgents"
  | "getClientAgent"
  | "listAccessRequests"
  | "requestAgentAccess"
  | "revokeAgentAccess"
  | "getClientToken"
  | "setClientToken";

export type ClientAgentStatus = "active" | "inactive";
export type ClientAccessRequestStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "revoked";
export type ClientAgentStatusFilter = ClientAgentStatus | "all";
export type ClientAccessRequestStatusFilter = ClientAccessRequestStatus | "all";
export type ClientAccessResponseKind = "list" | "detail" | "summary";

export interface ClientAgentAddress extends JsonObject {
  readonly street?: string;
  readonly number?: string;
  readonly district?: string;
  readonly city?: string;
  readonly state?: string;
  readonly zipCode?: string;
  readonly [key: string]: unknown;
}

export interface ClientAccessibleAgent extends JsonObject {
  readonly agentId: string;
  readonly name: string;
  readonly status: ClientAgentStatus;
  readonly profileVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly isHubConnected: boolean;
  readonly hasClientToken: boolean;
  readonly tradeName?: string | null;
  readonly document?: string | null;
  readonly cnpjCpf?: string | null;
  readonly documentType?: "cpf" | "cnpj" | null;
  readonly phone?: string | null;
  readonly mobile?: string | null;
  readonly email?: string | null;
  readonly address?: ClientAgentAddress;
  readonly notes?: string | null;
  readonly observation?: string | null;
  readonly profileUpdatedAt?: string | null;
  readonly [key: string]: unknown;
}

export interface ListClientAgentsResponse extends JsonObject {
  readonly agents: ClientAccessibleAgent[];
  readonly agentIds: string[];
  readonly count: number;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface GetClientAgentResponse extends JsonObject {
  readonly agent: ClientAccessibleAgent;
}

export interface ClientAgentAccessRequestRecord extends JsonObject {
  readonly id: string;
  readonly clientId: string;
  readonly agentId: string;
  readonly status: ClientAccessRequestStatus;
  readonly retryCount: number;
  readonly requestedAt: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly decidedAt?: string | null;
  readonly decisionReason?: string | null;
  readonly agentName?: string | null;
  readonly [key: string]: unknown;
}

export interface ListClientAccessRequestsResponse extends JsonObject {
  readonly items: ClientAgentAccessRequestRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface RequestAgentAccessResponse extends JsonObject {
  readonly requested: string[];
  readonly alreadyApproved: string[];
  readonly newRequests: string[];
  readonly reopened: string[];
  readonly debounced: string[];
}

export interface ClientAgentTokenResponse extends JsonObject {
  readonly agentId: string;
  readonly clientToken: string | null;
}

export interface RevokeAgentAccessSummary extends JsonObject {
  readonly revokeMode: "single" | "batch";
  readonly agentId?: string;
  readonly agentIds?: string[];
  readonly revokedCount: number;
  readonly response?: unknown;
}

export interface ClientAccessMetadata extends JsonObject {
  readonly operation: ClientAccessOperation;
  readonly kind: ClientAccessResponseKind;
  readonly itemIndex?: number;
  readonly total?: number;
  readonly page?: number;
  readonly pageSize?: number;
}

export type ClientAccessExecutionResult =
  | {
      readonly operation: "listClientAgents";
      readonly response: ListClientAgentsResponse;
    }
  | {
      readonly operation: "getClientAgent";
      readonly response: GetClientAgentResponse;
    }
  | {
      readonly operation: "listAccessRequests";
      readonly response: ListClientAccessRequestsResponse;
    }
  | {
      readonly operation: "requestAgentAccess";
      readonly response: RequestAgentAccessResponse;
    }
  | {
      readonly operation: "revokeAgentAccess";
      readonly response: RevokeAgentAccessSummary;
    }
  | {
      readonly operation: "getClientToken";
      readonly response: ClientAgentTokenResponse;
    }
  | {
      readonly operation: "setClientToken";
      readonly response: ClientAgentTokenResponse;
    };
