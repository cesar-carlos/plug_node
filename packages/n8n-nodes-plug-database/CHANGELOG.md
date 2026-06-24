# n8n-nodes-plug-database

## 3.3.0

### Minor Changes

- 77e7f48: Add Plug MCP Server and Plug AI Hub nodes for governed AI capability exposure via MCP-style tools/list and tools/call contracts.

## 3.2.0

### Minor Changes

- 39d77bf: Add bounded parallelism for safe read-only SQL input items via `executePerInputItem`, with `Max Parallel Input Items` node option, Auto Performance Hints, and hub inflight caps.
- 39d77bf: Improve socket performance defaults: adaptive stream pull window (`0` omits explicit override), honor configured pull window above agent recommendation, relay fast path default on typeVersion 1, omit traceId on relay command frames, and sample-based bulk insert size validation.
- 921e1fd: Add Auto Performance Hints (default on) for Socket SQL streaming and read-only batch parallelism, validate bulk insert against hub row/size limits before dispatch, and align relay stream pull window fallback to 256.

## 3.1.0

### Minor Changes

- 27f9527: Align the Plug Database node with hub contracts: emit one synthetic Aggregated JSON item when SQL returns zero rows, add guided `sql.bulkInsert`, expose `prefer_db_streaming` and batch parallel read options, map `replay_detected` (-32014) errors clearly, and decode PayloadFrame-wrapped `agents:command` socket responses for typeVersion 2.

### Patch Changes

- 27f9527: Add transient hub retries for SQL and metadata operations, reuse relay socket connections across items, optional Execute Batch input coalescing, and transport metrics in Plug metadata.
- Split oversized shared and node modules for maintainability. Improve socket reliability and performance with settled response handling, idle command timeouts, separate connect timeout, JSON-RPC id rotation on retry, relay managed transport reuse, O(n) stream row merge, relay metrics parity, safer n8n error output, and expanded tests.
- 27f9527: Extract guided SQL command builders into shared modules, add unit tests for hub SQL options and batch/bulk/cancel payloads, and extend live E2E suites for `sql.executeBatch`, hub options, and gated `sql.cancel`.

## 3.0.1

### Patch Changes

- Harden Plug session refresh to reduce avoidable auth churn.
  - Reuse access tokens until shortly before expiry instead of refreshing on every socket reconnect.
  - Centralize refresh scheduling in `sessionRefresh` with clearer error mapping for expired or invalid sessions.
  - Align socket error codes when refresh fails so workflows can branch on stable `PlugError` codes.
  - Add regression tests for token expiry boundaries and refresh backoff behavior.

## 3.0.0

### Major Changes

- dcfd49b: Audit hardening release. Three-pass review against the project rules. 28
  findings, all addressed. Quality gate green: 390 tests, lint, typecheck, build.

  ### Breaking changes
  - **Plug Tools / Encrypt Text**: PBKDF2 iteration count is now 600.000
    (was 120.000) to align with OWASP 2023 guidance. The encryption envelope
    now exposes the `iterations` field so Decrypt Text can decode payloads
    produced by older versions. Workflows that persist only `ciphertext`,
    `iv`, `salt` and `tag` without `iterations` will keep decoding using the
    legacy 120k default, but ciphertexts produced by 3.0.0 require the full
    envelope (including `iterations`) to be decrypted.
  - **Plug Tools / Validate Client Token**: the `valid` flag now reflects
    warnings consistently. Tokens shorter than 16 characters now return
    `valid: false` together with a warning (previously `valid: true` with a
    warning). Long tokens (> 4096) keep returning `valid: false`. Workflows
    relying on `valid: true` for short tokens must read `warnings` instead.
  - **HTTP transport**: when the underlying n8n HTTP helper returns a
    response without a numeric `statusCode`, the requester now throws
    `PlugError({ code: "HTTP_RESPONSE_MISSING_STATUS" })` instead of
    silently treating it as `200`. This surfaces malformed responses
    earlier instead of corrupting downstream parsers.

  ### Bug fixes
  - Stream Pull responses with no `requestId` or `streamId` now fail fast
    with the error code returned by the server instead of being silently
    ignored until the timeout fires.
  - Chunk row merging in relay and consumer socket sessions is now
    immutable; the shared response object is no longer mutated.
  - `continueOnFail` error output on the Plug Database node is now the
    same structured serializer used for per-item errors.
  - `csvToJson` no longer aborts on non-fatal `FieldMismatch` warnings
    from Papa Parse, so CSVs with variable row widths parse successfully.
  - `validateJsonSchema` accepts boolean schemas (`true` / `false`) as the
    JSON Schema specification requires.
  - Login / refresh helpers no longer carry dead `isRecord` guards.
  - `relay:conversation.started`, `agents:command_stream_chunk` and
    `agents:command_stream_complete` payloads are now strictly validated.
  - `connectErrorEvent` is now handled in the consumer command main loop.
  - `PlugValidationError` and `PlugTimeoutError` now honor the full
    `PlugErrorOptions` shape (including `technicalMessage`) instead of
    routing every option into `details`.

  ### Performance and security
  - PBKDF2 raised to 600k iterations (see breaking changes above).
  - Relay streaming now uses `decoded.frame.originalSize` from the
    PayloadFrame envelope instead of re-serialising every chunk to JSON.
  - `collectAllPages` is bounded by `MAX_COLLECT_PAGES = 100` and throws
    `COLLECT_PAGES_LIMIT_EXCEEDED` when the server returns a runaway
    `total`.
  - `base64DecodeToBuffer` now accepts the base64url alphabet (`-`, `_`)
    so JWT and webhook payloads decode cleanly.

  ### Standards and DRY
  - Shared `rest/parseHelpers.ts` centralizes record / string / number
    validators; client and user access modules dropped the duplicates.
  - REST list parsers no longer spread the raw record into the response,
    preventing unknown server fields from leaking into n8n output.
  - Three `SocketIo*Transport` wrappers were collapsed into
    `createSocketIoTransport(...)` plus a single transport class.
  - `buildAdvancedCommand` replaced a seven-level ternary chain with
    `operationOptionsCollectionMap`.
  - `revokeClientAgentAccess` now computes `isRevokeSingle` once.
  - `createControlError` and `createPublishedError` were collapsed into
    `buildSocketAckError`.
  - `safeStringify` was renamed to `stringifyJson` to drop the misleading
    "safe" prefix.
  - `DigestEncoding` was moved to the top of `security.ts`.

  ### Tests
  - 23 new regression tests across `parseHelpers`, `resourceClient` page
    guard, custom socket events REST parser, relay validation regressions
    and consumer stream-pull fail-fast scenarios.
  - The conditional skip in `plugToolsPdfSmoke.test.ts` is now documented
    (enable with `PLUG_TEST_REAL_PDF=1`).
  - Cleaned three unused identifiers reported by an expanded ESLint sweep
    across `tests/`, `scripts/` and `shared/`.

## 2.1.1

### Patch Changes

- 4b3c3ba: Harden socket command correlation, PayloadFrame decoding, auth reconnect, trigger backpressure handling, protocol versioning, socket runtime metrics, and guided SQL UX validation.

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
