# Project Summary

## Objective

Plug Database is an n8n integration focused on executing agent commands with the lowest possible setup friction.

The user only provides:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

The node handles login, session refresh, command execution, response normalization, Socket relay transport, local tool operations, and Socket Event workflows.

## Published packages

- `n8n-nodes-plug-database`
  - canonical REST + Socket package
  - includes local PDF and barcode tool runtimes
  - includes Socket Event trigger and Plura.ai Automations trigger
  - n8n Cloud verification must be checked separately

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

## Tooling

- `@changesets/cli`
- `@n8n/node-cli`
- `typescript`
- `eslint`
- `prettier`
- `vitest`
- `release-it`

The package includes PDF and barcode tool runtime dependencies plus `socket.io-client` for Socket relay, Socket Event publishing, and one-shot Socket Event waiting.
