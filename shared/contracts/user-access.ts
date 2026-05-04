import type { JsonObject } from "./api";
import type { ClientAgentAccessRequestRecord } from "./client-access";

export type UserAccessOperation =
  | "listAgentCatalog"
  | "listManagedAccessRequests"
  | "approveAccessRequest"
  | "rejectAccessRequest"
  | "listAgentClients"
  | "revokeAgentClientAccess";

export interface AgentCatalogRecord extends JsonObject {
  readonly agentId: string;
  readonly name: string;
  readonly status: "active" | "inactive";
  readonly profileVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly tradeName?: string | null;
  readonly document?: string | null;
  readonly cnpjCpf?: string | null;
  readonly documentType?: "cpf" | "cnpj" | null;
  readonly phone?: string | null;
  readonly mobile?: string | null;
  readonly email?: string | null;
  readonly notes?: string | null;
  readonly observation?: string | null;
  readonly profileUpdatedAt?: string | null;
  readonly [key: string]: unknown;
}

export interface PaginatedAgentCatalogResponse extends JsonObject {
  readonly agents: AgentCatalogRecord[];
  readonly count: number;
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface ManagedAccessRequestRecord extends ClientAgentAccessRequestRecord {
  readonly clientEmail?: string | null;
  readonly clientName?: string | null;
  readonly clientLastName?: string | null;
  readonly [key: string]: unknown;
}

export interface ManagedAccessRequestListResponse extends JsonObject {
  readonly items: ManagedAccessRequestRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface AgentClientRecord extends JsonObject {
  readonly clientId?: string;
  readonly id?: string;
  readonly email?: string | null;
  readonly name?: string | null;
  readonly lastName?: string | null;
  readonly status?: string | null;
  readonly [key: string]: unknown;
}

export interface AgentClientListResponse extends JsonObject {
  readonly items: AgentClientRecord[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface UserAccessMutationSummary extends JsonObject {
  readonly resourceType: "accessRequest" | "agentClientAccess";
  readonly resourceId: string;
  readonly raw: unknown;
}

export interface UserAccessMetadata extends JsonObject {
  readonly operation: UserAccessOperation;
  readonly kind: "list" | "summary";
  readonly itemIndex?: number;
  readonly total?: number;
  readonly page?: number;
  readonly pageSize?: number;
}

export type UserAccessExecutionResult =
  | {
      readonly operation: "listAgentCatalog";
      readonly response: PaginatedAgentCatalogResponse;
    }
  | {
      readonly operation: "listManagedAccessRequests";
      readonly response: ManagedAccessRequestListResponse;
    }
  | {
      readonly operation: "approveAccessRequest";
      readonly response: UserAccessMutationSummary;
    }
  | {
      readonly operation: "rejectAccessRequest";
      readonly response: UserAccessMutationSummary;
    }
  | {
      readonly operation: "listAgentClients";
      readonly response: AgentClientListResponse;
    }
  | {
      readonly operation: "revokeAgentClientAccess";
      readonly response: UserAccessMutationSummary;
    };
