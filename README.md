# Plug Database n8n Workspace

[![CI](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml)
[![Publish](https://github.com/cesar-carlos/plug_node/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/publish.yml)

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

This repository contains the Plug Database n8n community node workspace.

## Packages

- `n8n-nodes-plug-database`
  - public REST-only package
  - candidate for n8n verification
  - exposes one consolidated `Plug Database` node
- `n8n-nodes-plug-database-advanced`
  - advanced npm package
  - REST + consumer socket support
  - exposes one consolidated `Plug Database Advanced` node

## User experience

The consolidated nodes are designed to keep setup simple. End users provide:

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

Both consolidated nodes start with `Resource`, then `Operation`.

Resources:

- `SQL`
- `Client Access`
- `User Access`

The SQL resource can override `Agent ID` and `Client Token` per workflow step. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The `Client Access` resource manages approved agents, access requests, and per-agent client tokens over REST.

The `User Access` resource browses the agent catalog and manages owner-side approval and revocation flows over REST.

Legacy access-only nodes remain registered for workflow compatibility, but they are hidden from the node creator for new users.

## Example workflows

- `Plug Database`
  - choose `Resource = SQL` to run SQL against one approved agent with credential defaults or per-node overrides
  - choose `Resource = Client Access` to list agents, request access, and manage per-agent client tokens
  - choose `Resource = User Access` to browse the shared agent catalog and manage owner approvals

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
