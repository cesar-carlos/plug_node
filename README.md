# Plug Database n8n Workspace

[![CI](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml)
[![Publish](https://github.com/cesar-carlos/plug_node/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/publish.yml)

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

This repository contains the Plug Database n8n community node workspace.

## Packages

- `n8n-nodes-plug-database`
  - public REST-only package
  - candidate for n8n verification
  - includes the SQL node, the client access node, and the user access node
- `n8n-nodes-plug-database-advanced`
  - advanced npm package
  - REST + consumer socket support
  - includes the SQL node, the client access node, and the user access node

## User experience

The SQL node is designed to keep setup simple. End users only provide:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`

The API base URL is fixed to:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

The implementation handles login, token refresh, REST execution, consumer socket execution, binary frame decoding, gzip handling, and normalized JSON output.

For the advanced SQL node:

- `Channel = Socket` prefers `agents:command` on `/consumers`
- older saved advanced workflows stay compatible with relay when needed
- the runtime probes socket capability once per execution and falls back to relay only when the newer transport does not answer
- large socket streams are protected by local buffer guardrails to avoid runaway memory use during node execution

The SQL node itself can override `Agent ID` and `Client Token` per workflow step. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The client access node uses a separate client-only credential with:

- `User (email)`
- `Password`

It manages approved agents, access requests, and per-agent client tokens over REST.

The user access node uses a separate user credential with:

- `User (email)`
- `Password`

It browses the agent catalog and manages owner-side approval and revocation flows over REST.

## Example workflows

- `Plug Database`
  - run SQL against one approved agent with credential defaults or per-node overrides
- `Plug Database Client Access`
  - list client agents with `Return All`
  - request access to multiple agents with native repeated `Agent ID` fields
  - read, set, or clear a per-agent client token
- `Plug Database User Access`
  - browse the shared agent catalog with filters and `Return All`
  - approve or reject client access requests as an owner
  - list approved clients for an agent and revoke one client when needed

## Local development

Recommended Node.js version:

- `22.22.0`

Main commands:

```bash
npm ci
npm run verify
npm run test:e2e
npm run pack:check
```

Useful commands:

```bash
npm run changeset
npm run changeset:status
npm run test:coverage
npm run scan:public
```

## Documentation

- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Architecture](https://github.com/cesar-carlos/plug_node/blob/main/docs/architecture.md)
- [Communication patterns](https://github.com/cesar-carlos/plug_node/blob/main/docs/communication-patterns.md)
- [Error and authorization contracts](https://github.com/cesar-carlos/plug_node/blob/main/docs/error-and-authorization-contracts.md)
- [UX decisions](https://github.com/cesar-carlos/plug_node/blob/main/docs/ux-decisions.md)
- [Testing strategy](https://github.com/cesar-carlos/plug_node/blob/main/docs/testing-strategy.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
- [Release process](https://github.com/cesar-carlos/plug_node/blob/main/docs/release-process.md)
- [Versioning strategy](https://github.com/cesar-carlos/plug_node/blob/main/docs/versioning-strategy.md)

## Verification path

For the verified community-node track, use only `n8n-nodes-plug-database`.

After a GitHub Actions publish succeeds, run the dedicated `Scan Public Package` workflow or execute:

```bash
npm run scan:public
```

This runs the official `@n8n/scan-community-package` check against the published npm package.

## Project rules

Read [AGENTS.md](https://github.com/cesar-carlos/plug_node/blob/main/AGENTS.md) first, then the source rules in [`.cursor/rules`](https://github.com/cesar-carlos/plug_node/tree/main/.cursor/rules).

## Contributing and security

- [Contributing guide](https://github.com/cesar-carlos/plug_node/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/cesar-carlos/plug_node/blob/main/SECURITY.md)
- [MIT License](https://github.com/cesar-carlos/plug_node/blob/main/LICENSE)
