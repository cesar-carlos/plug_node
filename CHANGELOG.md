# Plug Database Changelog

All notable changes to this workspace will be documented in this file.

The format is based on Keep a Changelog and the project currently uses a lightweight manual process.

## [Unreleased]

### Documentation

- Reorganized `docs/socket`: slimmer `examples.md` (canonical JSON under `docs/socket/examples/`), cross-links between guides, optional glossary, post-import checklist, and automated relative link verification (`npm run verify:doc-links`).

### Added

- Workspace scaffolding for the public REST-only package and the advanced REST + Socket package.
- Shared auth, transport, socket, output, and n8n integration layers.
- Repository automation with CI, contribution templates, CODEOWNERS, and security guidance.
- Changesets-based version control, release workflow, and versioning documentation.
- Compatibility aliases for legacy Plug credential names: `plugDatabaseApi`, `plugDatabaseAdvancedApi`, `plugDatabaseClientApi`, and `plugDatabaseUserApi` now extend `plugDatabaseAccountApi`.

### Changed

- GitHub Actions now repairs Linux optional native bindings before running `npm run verify`.

## [0.1.0] - 2026-05-01

### Added

- Initial Plug Database n8n workspace structure.
- Initial Plug Database workspace branding direction and package split.
- Project documentation under `docs/`.
