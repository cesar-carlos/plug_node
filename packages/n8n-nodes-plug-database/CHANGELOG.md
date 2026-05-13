# n8n-nodes-plug-database

## 2.1.0

### Minor Changes

- **Workflow migration:** remap legacy workflow credential keys (`plugDatabaseAdvancedApi`, `plugDatabaseApi`, `plugDatabaseClientApi`, `plugDatabaseUserApi`) to `plugDatabaseAccountApi` when running `migrate:workflows`. Add `--backup` and `--output-dir` for safer in-place or side-by-side JSON writes; document `--check` for CI.

- **Tooling and CI:** add `verify:doc-links` for relative Markdown link checks and include it in `npm run verify`. Tighten `verify:surface` Markdown scanning with explicit README allowlists. Run the Publish workflow after a successful `push` CI on `main`/`master`; keep full `verify` and `pack:check` on `workflow_dispatch`.

- **Documentation:** reorganize `docs/socket` (glossary, importable example workflows, cross-links, post-import checklist). Add `.node-version` (22.22.0) alongside `.nvmrc` and `engines`.

## 2.0.0

### Major Changes

- 200779f: Unify every authenticated Plug node around the shared `Plug Database Account API` credential, remove the legacy access-only and socket publisher compatibility nodes, and treat simultaneous installation of the public and advanced packages as unsupported.

## 1.4.2

### Patch Changes

- Improve custom socket event publish metadata and harden socket event session ordering.

  Published socket events now expose `requestId`, `idempotentReplay`, and delivery status metadata in node output.
  The socket session flow also avoids dropping events that arrive immediately after subscription acknowledgement and disconnects transports cleanly on readiness timeouts.

## 1.4.1

### Patch Changes

- b60d23b: Bundle Playwright Chromium for PDF rendering, switch the default browser channel to Auto, add the generic `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH` alias, and return actionable browser setup errors instead of raw Playwright launch failures.

## 1.4.0

## 1.3.0

### Minor Changes

- 5c7f2de: Expose PDF, barcode, and socket event publishing under the consolidated Plug Database Tools resource.

## 1.2.0

## 1.1.2

### Patch Changes

- Refresh the main node icons with the packaged Plug blockchain artwork so published builds pick up the updated branding reliably.

## 1.1.1

### Patch Changes

- Consolidate the public nodes around Resource-based navigation while keeping legacy access nodes hidden for compatibility.

## 1.1.0

### Minor Changes

- Add client and user access nodes, SQL agent and token overrides, and the new consumer socket transport with relay compatibility fallback.

## 1.0.0

### Major Changes

- 34ac072: Prepare GitHub Actions provenance publish after initial npm release

### Patch Changes

- d383dd3: Establish Changesets-based version control and release automation for the Plug Database workspace packages.
