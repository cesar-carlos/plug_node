# Contributing

Thanks for contributing to the Plug Database workspace.

## Before opening a pull request

1. Work from the current branch unless a branch change is explicitly requested.
2. Run `npm ci`.
3. Run `npm run verify`.
4. Run `npm run test:e2e` when your change affects transport, authentication, or output behavior (requires `.env`; see [tests/e2e/README.md](tests/e2e/README.md)).
5. Add a changeset with `npm run changeset` when package behavior changes.

Hub contract notes for maintainers: [docs/hub-contract-alignment.md](docs/hub-contract-alignment.md).

## Scope checklist

- package: `n8n-nodes-plug-database`
- shared core
- docs
- CI / tooling

## Rules

- shared imports stay within `shared/`; package code must not reach into sibling package paths (enforced by review; `import/no-restricted-paths` may be added later)
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

## Branch policy

- `main` is the only permanent branch in this repository.
- `changeset-release/main` is created temporarily by the Changesets release workflow and removed automatically after publish.
- Do not create long-lived feature branches in this repository unless a maintainer explicitly requests one for a coordinated change.
- Merged pull request branches are deleted automatically by GitHub and by the weekly branch cleanup workflow.
