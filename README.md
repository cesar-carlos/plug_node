# Plug Database n8n Workspace

[![CI](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml)
[![Release](https://github.com/cesar-carlos/plug_node/actions/workflows/publish.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/publish.yml)

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

This repository contains the unified Plug Database n8n community node package.

## Package

- `n8n-nodes-plug-database`
  - one canonical Plug Database package
  - exposes one consolidated `Plug Database` node
  - supports REST and consumer Socket execution
  - includes Socket Event publishing, one-shot Socket Event waiting, `Plug Database Socket Event Trigger`, `Plug Database Plura.ai Automations Trigger`, PDF, barcode, document, image, data, security, date/value, identity, and Plug-specific tools

The former `n8n-nodes-plug-database-advanced` package has been folded into `n8n-nodes-plug-database`. Deprecate the advanced package on npm after publishing this major release, and migrate workflows to the unified node surface.

After upgrading, uninstall `n8n-nodes-plug-database-advanced` from the n8n instance and restart n8n. If the old `Plug Database Advanced` entries still appear, reload the community node cache or reinstall the canonical package so n8n indexes only `n8n-nodes-plug-database`.

## User Experience

End users provide one shared Plug credential:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`
- optional `Payload Signing Key`
- optional `Payload Signing Key ID`

All authenticated Plug surfaces share:

- `Plug Database Account API`

Saved credentials created by older package versions remain supported through compatibility aliases. The legacy internal credential names `plugDatabaseApi`, `plugDatabaseAdvancedApi`, `plugDatabaseClientApi`, and `plugDatabaseUserApi` extend `plugDatabaseAccountApi`, so n8n can still show previously saved credentials in nodes that use the shared account credential.

Saved workflows that reference removed advanced node type names must be migrated:

- `plugDatabaseAdvanced` -> `plugDatabase`
- `plugDatabaseAdvancedSocketEventTrigger` -> `plugDatabaseSocketEventTrigger`
- `plugDatabaseAdvancedPdf` and `plugDatabaseAdvancedBarcode` -> `Plug Database` with `Resource = Tools`

For exported n8n workflow JSON files, run a dry run first and then write changes after reviewing the output:

```bash
npm run migrate:workflows -- ./workflow.json
npm run migrate:workflows -- --write ./workflow.json
```

The migrator updates legacy node `type` values, maps legacy credential keys (`plugDatabaseAdvancedApi`, `plugDatabaseApi`, `plugDatabaseClientApi`, `plugDatabaseUserApi`) to `plugDatabaseAccountApi` on each node, and can normalize hidden PDF/barcode nodes into `Plug Database` tools.

- `--check` exits with code `1` when any migration would apply (use in CI to ensure exports are already migrated).
- `--backup` with `--write` writes `<file>.bak` before overwriting each in-place export.
- `--write --output-dir <dir>` writes migrated JSON under `<dir>` while preserving paths relative to the current working directory; originals are left unchanged.

Credential remapping keeps the same n8n credential `id`; ensure the instance still has a compatible saved credential for `Plug Database Account API`.

The API base URL is fixed to:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

The implementation handles login, token refresh, REST execution, consumer Socket execution, binary frame decoding, gzip handling, and normalized JSON output.

`Plug Database` starts with `Resource`, then `Operation`.

Resources:

- `SQL`
- `Client Access`
- `User Access`
- `Tools`

For SQL, `Channel = Socket` prefers `agents:command` on `/consumers`, with relay fallback when the newer transport does not answer. Large Socket streams are protected by local buffer guardrails.

Tools include PDF/document conversion, image operations, barcode read/generation, CPF/CNPJ and UUID helpers, JSON/data utilities, security helpers, date/value helpers, SQL/socket payload helpers, REST or Socket custom event publishing, and one-shot Socket Event waiting.

Triggers stay as separate n8n nodes because n8n activates them through `trigger()` or webhook lifecycle methods, while `Plug Database` is an execution node that runs through `execute()`. They share the same package and naming prefix, but cannot be embedded as normal operations without losing trigger behavior.

`Plug Database Socket Event Trigger` listens on `/consumers` for exact `client:custom.*` events or `client:agent.profile.updated`.

`Plug Database Plura.ai Automations Trigger` receives webhook events when a Plura.ai automation node executes.

Detailed Socket documentation is available in [docs/socket](./docs/socket/README.md), including SQL over Socket, custom events, the continuous trigger, PayloadFrame, examples, and troubleshooting.

## Local Development

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
- [Socket guide](https://github.com/cesar-carlos/plug_node/blob/main/docs/socket/README.md)
- [Error and authorization contracts](https://github.com/cesar-carlos/plug_node/blob/main/docs/error-and-authorization-contracts.md)
- [UX decisions](https://github.com/cesar-carlos/plug_node/blob/main/docs/ux-decisions.md)
- [Testing strategy](https://github.com/cesar-carlos/plug_node/blob/main/docs/testing-strategy.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
- [Release process](https://github.com/cesar-carlos/plug_node/blob/main/docs/release-process.md)
- [Versioning strategy](https://github.com/cesar-carlos/plug_node/blob/main/docs/versioning-strategy.md)

## Verification Path

`n8n-nodes-plug-database` now ships the full Plug surface, including Socket and local tool runtime dependencies. `scan:public` is still useful, but do not read it as an n8n Cloud verification guarantee.

After GitHub Actions verifies a newly published npm version, the dedicated `Scan Public Package` workflow runs automatically. You can also run it manually or execute:

```bash
npm run scan:public
```

This runs the official `@n8n/scan-community-package` check against the published npm package.

## Project Rules

Read [AGENTS.md](https://github.com/cesar-carlos/plug_node/blob/main/AGENTS.md) first, then the source rules in [`.cursor/rules`](https://github.com/cesar-carlos/plug_node/tree/main/.cursor/rules).

## Contributing and Security

- [Contributing guide](https://github.com/cesar-carlos/plug_node/blob/main/CONTRIBUTING.md)
- [Security policy](https://github.com/cesar-carlos/plug_node/blob/main/SECURITY.md)
- [MIT License](https://github.com/cesar-carlos/plug_node/blob/main/LICENSE)
