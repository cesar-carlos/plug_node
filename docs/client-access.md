# Client Access

`Plug Database > Resource = Client Access` exposes the REST surface that the **client account** uses to discover agents, request access, and manage its own `Client Token` per agent. This guide covers each operation, the typical workflow patterns, and how the responses are shaped.

For the admin-side counterpart (approve requests, list / revoke clients on agents you own) see [User Access](./user-access.md).

## When to use

Use this resource when the n8n workflow runs **as a client** that needs to:

- discover which agents the client already has access to
- ask for access to a new agent
- look up access request status
- rotate or remove the `Client Token` used by SQL operations

All operations authenticate with the same `Plug Database Account API` credential used by the SQL resource. The client identity is implicit in the access token issued by `/client-auth/login`.

## Operations

### List Client Agents

`GET /client/me/agents`

Returns the agents the client currently has access to, with pagination.

Fields:

- `Status Filter`: `Active`, `Inactive`, or `All`
- `Search`: optional substring match against the agent name
- `Page`, `Page Size`: standard pagination
- `Refresh`: optional flag to force the server to re-fetch the underlying agent metadata

Response shape:

```json
{
  "agents": [
    {
      "agentId": "uuid",
      "name": "Agent name",
      "status": "active",
      "isHubConnected": true,
      "hasClientToken": true,
      "profileVersion": 3,
      "createdAt": "2026-01-12T...",
      "updatedAt": "2026-05-26T..."
    }
  ],
  "agentIds": ["uuid"],
  "count": 1,
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

### Get Client Agent

`GET /client/me/agents/:agentId`

Returns a single agent with the same record shape as the list operation, wrapped in `{ agent: ... }`.

### List Access Requests

`GET /client/me/agent-access-requests`

Returns the access requests created by this client. Useful to monitor approvals or to reconcile workflow state with the hub.

Fields:

- `Status Filter`: `Pending`, `Approved`, `Rejected`, `Expired`, `Revoked`, or `All`
- `Search`, `Page`, `Page Size`: standard list controls

Response shape:

```json
{
  "items": [
    {
      "id": "request-uuid",
      "agentId": "uuid",
      "agentName": "Agent name",
      "status": "pending",
      "retryCount": 0,
      "requestedAt": "...",
      "createdAt": "...",
      "updatedAt": "...",
      "decidedAt": null,
      "decisionReason": null
    }
  ],
  "total": 1,
  "page": 1,
  "pageSize": 50
}
```

### Request Agent Access

`POST /client/me/agents`

Requests access to one or more agents in a single call.

Fields:

- `Agent IDs (JSON)`: array of agent UUIDs

Response shape:

```json
{
  "requested": ["uuid-a", "uuid-b"],
  "alreadyApproved": ["uuid-c"],
  "newRequests": ["uuid-a"],
  "reopened": ["uuid-b"],
  "debounced": []
}
```

Each list tells you what the server did with the input:

- `newRequests`: a fresh pending request was created
- `reopened`: a previously rejected/expired request was re-submitted
- `alreadyApproved`: the client already has access; no new request was needed
- `debounced`: the request was rate-limited; retry later

### Revoke Agent Access

`DELETE /client/me/agents/:agentId` (single) or `DELETE /client/me/agents` with body `{ "agentIds": [...] }` (batch).

Choose `Revoke Mode = Single` for one agent or `Revoke Mode = Batch` for many. The single mode is preferred when revoking a specific agent because it produces a more precise audit trail.

Response shape:

```json
{
  "revokeMode": "single",
  "agentId": "uuid",
  "revokedCount": 1,
  "response": { ... }
}
```

or for batch:

```json
{
  "revokeMode": "batch",
  "agentIds": ["uuid-a", "uuid-b"],
  "revokedCount": 2,
  "response": { ... }
}
```

### Get Client Token

`GET /client/me/agents/:agentId/client-token`

Returns the `Client Token` currently configured for this client on the given agent. Useful when the workflow needs to inject the token into another tool.

Response shape:

```json
{
  "agentId": "uuid",
  "clientToken": "token-value-or-null"
}
```

`clientToken` may be `null` when the client has not been issued a token yet.

### Set Client Token

`PUT /client/me/agents/:agentId/client-token`

Sets or clears the `Client Token` used by this client on the given agent. Pass `null` to clear.

Fields:

- `Agent ID`: target agent
- `Client Token`: new token value or `null`

Response shape mirrors `Get Client Token`.

## Workflow patterns

### Bootstrap: ensure access before running SQL

1. `List Client Agents` to confirm the target agent is in the list.
2. If absent, `Request Agent Access` with the agent UUID.
3. Poll `List Access Requests` until `status = approved` or surface a notification.
4. Once approved, `Set Client Token` if the workflow manages tokens centrally.
5. Run `Plug Database > Resource = SQL` against the agent.

### Token rotation

1. `Get Client Token` to capture the current value.
2. Generate the new token externally (or via your secret store).
3. `Set Client Token` with the new value.
4. Update any downstream credential storage.

The Plug Database node always uses the token from the credential or the node parameter at execution time, so rotation takes effect on the next execution without restart.

### Decommission an agent

1. Confirm with `Get Client Agent` that the agent is still listed.
2. Run `Set Client Token` with `null` to forget the credential.
3. Run `Revoke Agent Access` to drop the access record.

## Error handling

Client Access calls share the same error contract as the rest of the node — see [Error and Authorization Contracts](./error-and-authorization-contracts.md). The most common categories here are:

- `401` — the client session expired; the node will refresh and retry once for safe operations.
- `403` — the agent owner blocked or removed access; no automatic retry.
- `429` — request throttled; honor `Retry-After`.
- `COLLECT_PAGES_LIMIT_EXCEEDED` — list operations stop after 100 pages. Use `Page` and `Page Size` to paginate manually for very large workspaces.
