# Release Process

## Official flow

The official publish path is GitHub Actions.

1. Implement the change.
2. Run `npm run verify`.
3. Run `npm run pack:check`.
4. Add a changeset when package behavior changes.
5. Merge to `main`.
6. The `Release` workflow creates or updates the version PR.
7. Merge the version PR to publish packages to npm.
8. The `Release` workflow publishes packages, verifies the npm version, creates the package tag, and deletes the stale `changeset-release/main` branch.
9. The `Release` workflow dispatches `Scan Public Package` only when it detects a newly published npm version. The scan can also run manually or from a package tag fallback.

## Version PR validation

The version PR is created by `changesets/action` with the default GitHub token. GitHub may not trigger pull request checks for commits created by that token, so the version PR can appear without checks even when the `main` branch is green. The CI workflow includes `changeset-release/main` for direct branch validation when GitHub emits a push event, but local validation remains the reliable fallback. After npm publish succeeds, the `Release` workflow removes `changeset-release/main` automatically; the branch is recreated the next time a version PR is opened.

When the `Release` workflow opens or updates a version PR, it also runs `npm run verify` and `npm run pack:check` directly on `changeset-release/main`. On success it attaches completed Check Runs named `verify`, `socket-protocol (test:socket:core)`, and `socket-protocol (test:socket:trigger)` to the version-PR commit so branch protection can merge without `--admin`.

Before merging the version PR:

1. Confirm the latest `main` `CI` and `Release` workflow runs are successful.
2. Confirm the Release workflow attached the three required Check Runs (or run `npm run verify` / `npm run pack:check` locally as fallback).
3. Confirm the version bump and changelog match `npm run changeset:status`.
4. For any credential or published-node hard break, confirm the version PR is cutting the next major release for `n8n-nodes-plug-database`.

## Branch hygiene

Repository policy keeps `main` as the only permanent branch:

- GitHub deletes the head branch automatically when a pull request is merged (`delete_branch_on_merge`).
- The `Release` workflow closes any open version PR and deletes `changeset-release/main` after a successful npm publish.
- The weekly `Branch Cleanup` workflow removes merged remote branches older than seven days, except `main` and `changeset-release/main`.
- A repository ruleset blocks creation of new branches outside `main` and `changeset-release/main`.

## Packages

- `n8n-nodes-plug-database`
  - canonical REST + Socket package

## Changelogs

- `packages/n8n-nodes-plug-database/CHANGELOG.md` is canonical for published package versions (generated/updated by Changesets).
- Root `CHANGELOG.md` is a workspace summary; after each release, fold matching `[Unreleased]` bullets into a dated `## [x.y.z]` section that mirrors the package release.

## Notes

- Use npm `12.2.1` for install, verification and release. CI installs the exact version before `npm ci`; the previous floating npm upgrade and native `--no-save` repairs are removed.
- When the system npm cannot be upgraded without administrator rights, use `npx --yes npm@12.2.1 run verify` and the same launcher for other workspace commands. No administrator access is needed for this isolated execution.
- `npm run verify:toolchain` checks TypeScript `7.0.2` for compilation and the `6.0.2` API compatibility package for analysis. The root override pins only `@typescript/old`, the compatibility wrapper's dependency, so a floating patch cannot silently change the compiler API.
- CLI `0.54.6` and ESLint `10.14.0` are validated with a narrow self-hosted profile: runtime dependencies must be reviewed and exactly pinned, while protocol errors are normalized at node entry points. All other upstream lint checks remain enabled. See the documented exceptions in the package ESLint config.
- Dependency updates must retain the TypeScript compiler/API aliases and the Zod 3 host peer until their consumers support newer APIs. Use the audit report to distinguish host/tooling findings from the package runtime; do not apply forced major-version replacements to silence advisories.
- The legacy root `ignore@5.3.2` peer bridge was removed with CLI 0.54.6. Dependency-cruiser resolves its own version 7.
- `npm run pack:check` loads all five nodes and six credentials from installed tarballs with `n8n-workflow` `2.16.0` and `2.45.4`. A third installation enables approved scripts and exercises sharp, Chromium PDF generation and PDF.js extraction. Package size gates remain unchanged.
- npm 12 install-script approvals are explicit in the root manifest. Chromium and the resolver are approved; the CLI plugin's pnpm-only preinstall is denied because it does not build any required runtime artifact. Unreviewed optional SDK native scripts are not executed by this migration.

- `n8n-nodes-plug-database` is the n8n verification candidate
- trusted publishing on npm should point to `publish.yml`
- provenance is generated by the GitHub Actions release workflow
- the final verification check should run on Node `24.18.0`
- the scanner target is `n8n-nodes-plug-database`
- package publication is delegated to `changeset publish`, not raw `npm publish`, so repeated pushes do not try to overwrite an existing npm version
- `Scan Public Package` is triggered by a `package-published` repository dispatch after npm version verification; `n8n-nodes-plug-database@*` tags remain a fallback
- `npm run pack:check` now includes a real tarball installation smoke test, so run it only after a successful build/verify path
- after the unified major release, deprecate `n8n-nodes-plug-database-advanced` on npm and direct users to `n8n-nodes-plug-database`
- Dependabot opens weekly pull requests for GitHub Actions updates

## Required staging smoke

Publishing requires a successful `test:e2e:release` job on the exact release commit in the GitHub `staging` environment. Configure `PLUG_E2E_USER`, `PLUG_E2E_PASSWORD`, `PLUG_E2E_AGENT_ID`, `PLUG_E2E_CLIENT_TOKEN`, and `PLUG_E2E_BASE_URL` there. Optional socket credentials use `PLUG_E2E_SOCKET_AGENT_ID` and `PLUG_E2E_SOCKET_CLIENT_TOKEN`. Missing configuration or offline infrastructure blocks publication; version-PR creation does not require staging.
