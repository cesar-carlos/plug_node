# Architecture

## Workspace layout

- `packages/n8n-nodes-plug-database`
- `packages/n8n-nodes-plug-database-advanced`
- `shared`
- `tests`
- `docs`

## Package responsibilities

### Public package

- REST-only
- no runtime dependencies
- verification candidate for n8n

### Advanced package

- REST + Socket relay
- includes `socket.io-client`
- npm-only distribution

## Shared core

The shared layer is copied into package-local `generated/shared` during build and test preparation.

Main shared areas:

- `auth`
  - login
  - refresh
  - session reuse
- `contracts`
  - REST and JSON-RPC types
  - error contracts
- `rest`
  - bridge execution
- `socket`
  - relay session and frame codec
- `output`
  - n8n item shaping
- `n8n`
  - node description builder
  - node execution helper

## Public package isolation

The sync process removes socket-only code from the public package output so the published REST package does not include runtime socket modules.
