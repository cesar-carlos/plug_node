# n8n-nodes-plug-database-advanced

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database-advanced` is the advanced Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database-advanced
```

## What this package adds

- `Channel = REST | Socket`
- consumer socket execution through `/consumers`
- `Chunk Items` output mode for socket streams
- client-to-agent access management over REST
- automatic capability probe for `agents:command`, with silent relay fallback for older saved workflows

## Included nodes

- `Plug Database Advanced`
  - consolidated node with `Resource = SQL | Client Access | User Access`

## Supported operations

`Resource = SQL`:

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

`Resource = Client Access`:

- `List Client Agents`
- `Get Client Agent`
- `List Access Requests`
- `Request Agent Access`
- `Revoke Agent Access`
- `Get Client Token`
- `Set Client Token`

`Resource = User Access`:

- `List Agent Catalog`
- `List Access Requests`
- `Approve Access Request`
- `Reject Access Request`
- `List Agent Clients`
- `Revoke Agent Client Access`

## Credentials

The credential asks for:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`

The SQL node can override `Agent ID` and `Client Token` per node. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Output modes

- `Aggregated JSON`
- `Chunk Items`
- `Raw JSON-RPC`
- optional `Include Plug Metadata`

Both access nodes also support:

- `Return All` for paginated listing operations
- standardized summary items with `success`, `operation`, `resourceType`, `resourceId`/`resourceIds`, and `raw`

## Notes

- this package is published to npm but is not intended for n8n verification
- it includes the `socket.io-client` runtime dependency required for consumer socket transport

## Quick examples

- Use `Plug Database Advanced` with `Resource = Client Access` to manage approved client agents and per-agent client tokens over REST.
- Use `Plug Database Advanced` with `Resource = User Access` to browse the agent catalog and approve or reject client access requests.
- Use `Plug Database Advanced` with `Resource = SQL` and credential defaults for the common target, then override `Agent ID` or `Client Token` only in the socket or REST steps that need a different agent.
- Use `Plug Database Advanced` with `Resource = SQL` when the workflow needs consumer socket execution or `Chunk Items` on SQL execution.

## Socket compatibility

- New executions with `Resource = SQL` and `Channel = Socket` prefer `agents:command` on `/consumers`.
- Older saved advanced workflows that were already using relay remain compatible without adding a new user-facing option.
- When the server does not answer the newer consumer socket transport, the runtime falls back to relay for single-command flows.
- `Execute Batch` over socket requires `agents:command`; when the server does not support it, use `REST` or upgrade the server.
- Large socket streams are protected by local buffer guardrails so the node fails clearly instead of letting memory grow without bounds.

Legacy access-only nodes remain published for compatibility with existing workflows, but are hidden from the node creator for new users.

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Communication patterns](https://github.com/cesar-carlos/plug_node/blob/main/docs/communication-patterns.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
