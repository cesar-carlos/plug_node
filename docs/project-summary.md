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
  - candidate for n8n verification
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

## Out of scope for v1

- realtime trigger nodes
- access governance flows
- approved-agent management flows
- owner/admin UI flows
- legacy `agents:command` transport

## Tooling

- `@changesets/cli`
- `@n8n/node-cli`
- `typescript`
- `eslint`
- `prettier`
- `vitest`
- `release-it`

The advanced package adds `socket.io-client` as its only runtime dependency.
