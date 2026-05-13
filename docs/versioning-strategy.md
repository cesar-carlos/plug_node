# Versioning Strategy

## Standard

The workspace uses:

- `Semantic Versioning`
- `Changesets`
- `Conventional Commits` as the recommended commit style

## Published package

This workspace publishes:

- `n8n-nodes-plug-database`

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
  - removing previously published nodes or credentials
  - removing a previously published package from the workspace

## Plug-specific guidance

For this workspace, a change that renames, replaces, or removes a published Plug credential or Plug node must ship as the next major release of `n8n-nodes-plug-database`.

If the change removes or deprecates a package, document that explicitly in the changeset and package README. Credential aliases may remain as compatibility shims when they do not reintroduce duplicate node surfaces.
