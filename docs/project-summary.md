# Project Summary

## Objective

Plug Database is an n8n integration focused on executing agent commands, managing client/agent access, listening to socket events, and providing a unified tools surface with the lowest possible setup friction.

The user only provides:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`
- optional `Payload Signing Key`
- optional `Payload Signing Key ID`

The node handles login, session refresh, command execution, response normalization, Socket relay transport, local tool operations, and Socket Event workflows.

## Published packages

- `n8n-nodes-plug-database`
  - canonical REST + Socket package
  - includes the consolidated `Plug Database` node with four resources
  - includes local PDF, barcode, image, and document tool runtimes
  - includes `Plug Database Socket Event Trigger` and `Plug Database Plura.ai Automations Trigger`
  - n8n Cloud verification must be checked separately

## Fixed API base URL

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Nodes shipped

- `Plug Database` — consolidated node with `Resource = SQL | Client Access | User Access | Tools`
- `Plug Database Socket Event Trigger` — continuous listener for `client:custom.*` events or `client:agent.profile.updated`
- `Plug Database Plura.ai Automations Trigger` — webhook receiver for Plura.ai automation nodes

## Resources and operations

For the canonical, always-current list see the [package README](../packages/n8n-nodes-plug-database/README.md#supported-operations). Summary by resource:

- `Resource = SQL` — `Validate Context`, `Execute SQL`, `Execute Batch`, `Cancel SQL`, `Discover RPC`, `Get Agent Profile`, `Get Client Token Policy`
- `Resource = Client Access` — list and inspect agents the client can use, request and revoke agent access, read or rotate client tokens. See [Client Access guide](./client-access.md).
- `Resource = User Access` — admin surface for the agent owner: catalog of agents, approve or reject access requests, list and revoke agent client access. See [User Access guide](./user-access.md).
- `Resource = Tools` — local utilities for documents, images, codes, identity, data, security, dates, Plug-specific helpers, and socket event publish/wait.

## Channels

- `Channel = REST` — default for every operation
- `Channel = Socket` — available for `Resource = SQL` and unlocks `Chunk Items` response mode for streamed results. See [Socket guide](./socket/README.md).

## Tooling

- `@changesets/cli`
- `@n8n/node-cli`
- `typescript`
- `eslint`
- `prettier`
- `vitest`
- `release-it`

The package includes PDF and barcode tool runtime dependencies plus `socket.io-client` for Socket relay, Socket Event publishing, and one-shot Socket Event waiting.

## Versioning

This workspace follows [Semantic Versioning](./versioning-strategy.md). The current published release is `3.1.0`; see the [package CHANGELOG](../packages/n8n-nodes-plug-database/CHANGELOG.md), [UX decisions for 3.1.0](./ux-decisions.md#310-workflow-visible-changes), and [3.0.0 breaking changes](./ux-decisions.md#300-breaking-changes). See the [release process](./release-process.md) for the publish flow.
