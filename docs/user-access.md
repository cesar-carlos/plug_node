# User Access

`Plug Database > Resource = User Access` exposes the REST surface that an **agent owner** uses to discover the agent catalog, decide on access requests, and manage the client list of agents they own. This guide covers each operation, the typical workflow patterns, and how the responses are shaped.

For the client-side counterpart (request access, manage your own client token) see [Client Access](./client-access.md).

## When to use

Use this resource when the n8n workflow runs **as the user that owns one or more agents** and needs to:

- browse the public agent catalog
- approve or reject pending client access requests
- list which clients currently have access to a given agent
- revoke a client's access to a specific agent

All operations authenticate with the same `Plug Database Account API` credential used by the SQL resource. The user identity is implicit in the access token issued by `/auth/login`.

## Operations

### List Agent Catalog

`GET /agents/catalog`

Returns the discoverable agent catalog with pagination.

Fields:

- `Status Filter`: `Active`, `Inactive`
- `Search`: optional substring match
- `Page`, `Page Size`: standard pagination

Response shape:

```json
{
  "agents": [
    {
      "agentId": "uuid",
      "name": "Agent name",
      "status": "active",
      "profileVersion": 3,
      "createdAt": "...",
      "updatedAt": "..."
    }
  ],
  "count": 25,
  "total": 142,
  "page": 1,
  "pageSize": 25
}
```

### List Access Requests

`GET /me/client-access-requests`

Returns the access requests that target the agents owned by the authenticated user. Tolerates both array and object responses from the server.

Response shape:

```json
{
  "items": [
    {
      "id": "request-uuid",
      "clientId": "client-uuid",
      "agentId": "uuid",
      "status": "pending",
      "requestedAt": "...",
      "createdAt": "...",
      "updatedAt": "...",
      "clientEmail": "client@example.com",
      "clientName": "Jane",
      "clientLastName": "Doe"
    }
  ],
  "total": 3,
  "page": 1,
  "pageSize": 50,
  "raw": "..."
}
```

`raw` keeps the original server payload for debugging when needed.

### Approve Access Request

`POST /me/client-access-requests/:requestId/approve`

Approves a pending request. The server accepts `200` or `204`. The node returns a summary item:

```json
{
  "resourceType": "accessRequest",
  "resourceId": "request-uuid",
  "raw": "..."
}
```

Use this in a workflow that watches incoming requests (for example via a Plura.ai automation trigger or a polling schedule) and decides automatically.

### Reject Access Request

`POST /me/client-access-requests/:requestId/reject`

Same shape and accepted status codes as `Approve Access Request`.

### List Agent Clients

`GET /me/agents/:agentId/clients`

Returns the clients currently allowed to use the agent.

Fields:

- `Agent ID`: target agent

Response shape:

```json
{
  "items": [
    {
      "clientId": "client-uuid",
      "id": "client-uuid",
      "email": "client@example.com",
      "name": "Jane",
      "lastName": "Doe",
      "status": "active"
    }
  ],
  "total": 12,
  "page": 1,
  "pageSize": 50,
  "raw": "..."
}
```

### Revoke Agent Client Access

`DELETE /me/agents/:agentId/clients/:clientId`

Removes a single client from the agent. Accepts `200` or `204`. The node returns a summary item:

```json
{
  "resourceType": "agentClientAccess",
  "resourceId": "client-uuid",
  "agentId": "agent-uuid",
  "raw": "..."
}
```

Use in workflows that watch security events (for example a leaked credential alert) and need to quickly cut access.

## Workflow patterns

### Auto-approve based on policy

1. `List Access Requests` filtered by `status = pending`.
2. For each item, evaluate a policy node (allowlist email domain, geo IP, etc.).
3. If approved by policy: `Approve Access Request`. Else `Reject Access Request`.
4. Send a notification (Slack, email) with the decision.

### Quarterly access review

1. `List Agent Catalog` to enumerate owned agents.
2. For each agent: `List Agent Clients`.
3. Cross-check with HR / IAM data to find stale accesses.
4. For removed accesses: `Revoke Agent Client Access`.

### Manual approval pipeline

1. Trigger: `Plug Database Socket Event Trigger` listening to a custom event raised by the request creation.
2. Format a message and send to an approval channel (Slack, Teams).
3. On approval: `Approve Access Request`. On denial: `Reject Access Request`.

## Error handling

User Access calls share the same error contract as the rest of the node — see [Error and Authorization Contracts](./error-and-authorization-contracts.md). The most common categories here are:

- `401` — the user session expired; the node will refresh and retry once for safe operations.
- `403` — the user does not own the agent or has been suspended; no automatic retry.
- `404` — the request id no longer exists (already decided or expired); inspect `raw` for the server message.
- `429` — request throttled; honor `Retry-After`.
- `COLLECT_PAGES_LIMIT_EXCEEDED` — list operations stop after 100 pages. Use `Page` and `Page Size` to paginate manually for very large catalogs.
