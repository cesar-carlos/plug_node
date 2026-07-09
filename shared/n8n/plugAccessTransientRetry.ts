import type { ClientAccessOperation } from "../contracts/client-access";
import type { UserAccessOperation } from "../contracts/user-access";

/** Safe/idempotent Client Access ops that may use transient HTTP retries. */
const clientAccessSafeRetryOperations = new Set<ClientAccessOperation>([
  "listClientAgents",
  "getClientAgent",
  "listAccessRequests",
  "getClientToken",
]);

/** Safe/idempotent User Access ops that may use transient HTTP retries. */
const userAccessSafeRetryOperations = new Set<UserAccessOperation>([
  "listAgentCatalog",
  "listManagedAccessRequests",
  "listAgentClients",
]);

export const clientAccessAllowsTransientRetry = (
  operation: ClientAccessOperation,
): boolean => clientAccessSafeRetryOperations.has(operation);

export const userAccessAllowsTransientRetry = (
  operation: UserAccessOperation,
): boolean => userAccessSafeRetryOperations.has(operation);
