# Contributing

Thanks for contributing to the Plug Database workspace.

## Before opening a pull request

1. Work from the current branch unless a branch change is explicitly requested.
2. Run `npm ci`.
3. Run `npm run verify`.
4. Run `npm run test:e2e` when your change affects transport, authentication, or output behavior.
5. Add a changeset with `npm run changeset` when package behavior changes.

## Scope checklist

- package: `n8n-nodes-plug-database`
- shared core
- docs
- CI / tooling

## Rules

- keep all public documentation in English
- do not commit `dist/`, `generated/`, `.env`, or credential material
- keep runtime dependencies scoped to the package features that require them
- preserve the simple credential experience:
  - `User (email)`
  - `Password`
  - `Agent ID`
  - `Client Token`

## Release-related changes

Use GitHub Actions as the official publish path. Do not publish packages manually from a local machine for the verified package flow.
