# Contributing

Thanks for contributing to the Plug Database workspace.

## Before opening a pull request

1. Work from a dedicated branch.
2. Run `npm ci`.
3. Run `npm run verify`.
4. Run `npm run test:e2e` when your change affects transport, authentication, or output behavior.
5. Add a changeset with `npm run changeset` when package behavior changes.

## Scope checklist

- public package: `n8n-nodes-plug-database`
- advanced package: `n8n-nodes-plug-database-advanced`
- shared core
- docs
- CI / tooling

## Rules

- keep all public documentation in English
- do not commit `dist/`, `generated/`, `.env`, or credential material
- keep the public package free from runtime dependencies
- preserve the simple credential experience:
  - `User (email)`
  - `Password`
  - `Agent ID`
  - `Client Token`

## Release-related changes

Use GitHub Actions as the official publish path. Do not publish packages manually from a local machine for the verified package flow.
