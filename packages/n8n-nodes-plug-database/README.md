# n8n-nodes-plug-database

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database` is the public Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database
```

## What this package does

- REST-only command execution
- client-to-agent access management over REST
- fixed Plug Database API base URL
- guided mode for common operations
- advanced mode for raw JSON-RPC commands

## Included nodes

- `Plug Database`
  - SQL/JSON-RPC execution over REST
- `Plug Database Client Access`
  - manages approved agents, access requests, and per-agent client tokens
- `Plug Database User Access`
  - browses the agent catalog and manages owner-side access approvals

## Supported operations

SQL node:

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

Client access node:

- `List Client Agents`
- `Get Client Agent`
- `List Access Requests`
- `Request Agent Access`
- `Revoke Agent Access`
- `Get Client Token`
- `Set Client Token`

User access node:

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

The client access credential asks for:

- `User (email)`
- `Password`

The user access credential asks for:

- `User (email)`
- `Password`

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Output modes

- `Aggregated JSON`
- `Raw JSON-RPC`
- optional `Include Plug Metadata`

`Execute SQL` returns one n8n item per row when the response contains tabular rows.

Both access nodes also support:

- `Return All` for paginated listing operations
- optional `Include Plug Metadata`
- standardized summary items with `success`, `operation`, `resourceType`, `resourceId`/`resourceIds`, and `raw`

## Quick examples

- Use `Plug Database Client Access` to request access to several agents with repeated `Agent ID` rows instead of raw JSON arrays.
- Use `Plug Database Client Access` with `Return All` to fetch the full approved-agent list in one step.
- Use `Plug Database` with credential defaults for the common agent, then override `Agent ID` or `Client Token` only in the steps that need a different target.
- Use `Plug Database User Access` to review pending access requests, then approve or reject each request by `Request ID`.
- Use `Plug Database User Access` to list clients approved for one agent and revoke a single `Client ID` when necessary.

## Limitations

- no Socket relay support
- no realtime trigger in v1
- `Execute Batch` runs over REST only

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
- [Release process](https://github.com/cesar-carlos/plug_node/blob/main/docs/release-process.md)
