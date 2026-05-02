# Versioning Strategy

## Standard

The workspace uses:

- `Semantic Versioning`
- `Changesets`
- `Conventional Commits` as the recommended commit style

## Fixed version group

These packages are versioned together:

- `n8n-nodes-plug-database`
- `n8n-nodes-plug-database-advanced`

## Release intent

Add a changeset when a change affects package behavior, public metadata, or published output.

Docs-only and repository-only changes can skip a changeset when package behavior is unchanged.

## SemVer guidance

- `PATCH`
  - bug fixes
  - packaging fixes
  - non-breaking reliability improvements
- `MINOR`
  - new backward-compatible operations
  - new output modes
  - additive UX improvements
- `MAJOR`
  - breaking credential changes
  - breaking parameter changes
  - incompatible output changes
