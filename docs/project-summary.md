# Project Summary

## Objective

Plug Database is an n8n integration focused on executing agent commands with the lowest possible setup friction.

The user only provides:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

The node handles login, session refresh, command execution, response normalization, and, in the advanced package, Socket relay transport.

## Published packages

- `n8n-nodes-plug-database`
  - public REST-only package
  - includes local PDF and barcode tool runtimes
  - n8n Cloud verification must be checked separately
- `n8n-nodes-plug-database-advanced`
  - advanced npm package
  - REST + Socket relay support

## Fixed API base URL

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Supported operations

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

## Out of scope for the public package

- Socket relay transport
- Socket Event publish over Socket
- realtime trigger nodes

## Tooling

- `@changesets/cli`
- `@n8n/node-cli`
- `typescript`
- `eslint`
- `prettier`
- `vitest`
- `release-it`

Both packages include the PDF and barcode tool runtime dependencies. The advanced package also adds `socket.io-client` for Socket relay and Socket Event publishing.
