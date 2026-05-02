# n8n-nodes-plug-database-advanced

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database-advanced` is the advanced Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database-advanced
```

## What this package adds

- `Channel = REST | Socket`
- relay execution through `/consumers`
- `Chunk Items` output mode for socket streams

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
- `Chunk Items`
- `Raw JSON-RPC`
- optional `Include Plug Metadata`

## Notes

- this package is published to npm but is not intended for n8n verification
- it includes the `socket.io-client` runtime dependency required for relay transport

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Communication patterns](https://github.com/cesar-carlos/plug_node/blob/main/docs/communication-patterns.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
