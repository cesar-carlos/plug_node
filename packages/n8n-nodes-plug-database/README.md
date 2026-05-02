# n8n-nodes-plug-database

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database` is the public Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database
```

## What this package does

- REST-only command execution
- fixed Plug Database API base URL
- guided mode for common operations
- advanced mode for raw JSON-RPC commands

## Supported operations

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

## Credentials

The credential asks for:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Output modes

- `Aggregated JSON`
- `Raw JSON-RPC`
- optional `Include Plug Metadata`

`Execute SQL` returns one n8n item per row when the response contains tabular rows.

## Limitations

- no Socket relay support
- no realtime trigger in v1
- `Execute Batch` runs over REST only

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
- [Release process](https://github.com/cesar-carlos/plug_node/blob/main/docs/release-process.md)
