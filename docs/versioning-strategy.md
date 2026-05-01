# Versioning Strategy

## Standard adopted

The workspace uses:

- `Semantic Versioning (SemVer)` for version meaning
- `Changesets` for monorepo version control and changelog generation
- `Conventional Commits` as the recommended commit-message convention

## Why this combination

- `SemVer` is the de-facto standard for npm package version meaning.
- `Changesets` is a widely used monorepo tool for coordinating package bumps and changelogs.
- `Conventional Commits` makes commit history easier to scan and aligns well with release notes.

## Rules for this workspace

- Both package outputs are versioned together:
  - `n8n-nodes-plug-client`
  - `n8n-nodes-plug-client-internal`
- Package-affecting changes should include a changeset file.
- Docs-only, repository-only, or GitHub-only changes may skip a changeset when they do not change package behavior.
- Version numbers follow `MAJOR.MINOR.PATCH`.

## SemVer meaning here

- `PATCH`
  - bug fixes
  - reliability improvements
  - non-breaking metadata and packaging fixes
- `MINOR`
  - new backward-compatible operations
  - new backward-compatible parameters or output modes
  - additive REST or SOCKET support improvements
- `MAJOR`
  - breaking credential changes
  - breaking node parameter changes
  - incompatible output changes
  - transport behavior changes that break existing workflows

## Day-to-day workflow

1. Implement the change.
2. Run `npm run verify`.
3. If the change affects package behavior, run `npm run changeset`.
4. Commit the code and the new `.changeset/*.md` file together.
5. Merge to `main`.
6. The release workflow creates or updates a version PR.
7. When that PR is merged, package versions and changelogs are updated in a controlled way.

## Notes

- The repository root stays `private`; version control is centered on the workspace packages.
- The fixed Changesets group keeps both packages on the same visible version for simpler support and documentation.
