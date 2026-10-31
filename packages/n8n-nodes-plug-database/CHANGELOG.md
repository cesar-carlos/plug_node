# n8n-nodes-plug-database

## 3.8.0

### Minor Changes

- f87e8da: Add List Available Actions to Agent Action I/O. Workflows can discover authorized saved actions one page at a time over REST, Socket or relay and continue using the returned cursor.

  When the agent denies catalog access, show the operator which local credential permissions to check and preserve the structured authorization error in Continue On Fail output.

- f87e8da: Add guided faithful Agent Action I/O, a separate agent credential, byte-preserving binary input/output and caller-owned recovery checkpoints over single-dispatch REST, Socket and relay. Add bounded source inspection, agent health and durable SQL operation execution/get/cancel with method-specific validation and no replay or transport fallback. Preserve structured uncertainty and SQL cancellation credentials. Existing SQL workflows and installed node identities remain compatible.

### Patch Changes

- f87e8da: Reject mismatched relay agents and ignore Socket responses received before dispatch. Preserve uncertain command outcomes across transports and disconnect even if relay cleanup fails. Reject inherited method names before dispatch and count validated base64 output bytes without decoding them again.
- f87e8da: Present safe Portuguese diagnostics for unavailable, disabled, incompatible and unimplemented agent features across I/O, SQL extensions and legacy transports. Preserve structured error codes and recovery metadata without leaking native error prose or retrying availability failures. Explicit JSON-RPC method-not-found responses indicate non-execution; missing capabilities and timeouts do not imply an outdated agent or absence of effects.

  Handle a correlated `relay:rpc.accepted` refusal immediately so it reaches the caller with its Hub diagnostics instead of timing out while waiting for a result.

- f87e8da: Update stable runtime and development dependencies, including Playwright, jose, marked, to-words, the Zod 4 alias, n8n tooling, ESLint, and Vitest. Preserve the Zod 3 host peer and Node 24 type compatibility. Normalize uncaught execution errors at node boundaries, validate pinned self-hosted runtime dependencies, and update the native compatibility installation profiles. Refresh transitive resolutions and constrain qs to its corrected version.

  Adopt corrected Portuguese number wording from to-words 7.4.1: for example, 1001 now returns "Mil E Um" instead of "Mil Um". Node operations and parameters remain unchanged.

- f87e8da: Reduce npm package size by excluding development JavaScript source maps from the published tarball while retaining them in local builds. Preserve runtime JavaScript, declarations, JSON assets, icons, dependencies, and registered nodes/credentials. Validate that every built artifact except these maps is included in the tarball.
- f87e8da: Enforce MCP call budgets across input items, reject invalid budget configuration, and fail when an explicitly configured AI Hub cannot be resolved. Move MCP orchestration into shared helpers and strengthen architecture, coverage, and release validation.

## 3.7.0

### Minor Changes

- 22ac2a3: Separate hub wait, transport margin and connection deadlines, with an explicit 30-second default hub wait and SQL-aware batch/bulk timeouts. Validate incoming socket frames once per connection, reserve pending memory before decoding, isolate command ownership and agent stream hints, and cancel pending pulls and response work on completion or failure. Retain correlated inactivity timeouts for active streams, existing wire formats and the prohibition on ambiguous SQL retries. Bound gzip output while inflating, select measured gzip level 3 and add repeatable concurrency and compression measurements.

### Patch Changes

- 22ac2a3: Align PayloadFrame compression with the hub inflation limit and reject oversized payloads before allocation. Enforce required signatures on legacy consumer JSON, reuse renewed sessions for late parallel auth failures, and isolate command activity and timing metrics on shared sockets. Reject aborted or failed streams before returning partial data. Avoid automatic SQL redispatch after REST timeouts, HTTP 5xx, ambiguous transport failures, or rejected stream pulls.
- 22ac2a3: Update runtime dependencies and compile the package with TypeScript 7 while preserving CommonJS loading and the existing node, credential, and JSON-RPC contracts. Keep Zod 3 for n8n peers and use an isolated Zod 4 alias for Plug validation, preserving public error messages and SQL refinements. Adapt PDF.js cleanup to release loading resources on success and failure, and validate installed packages with both supported n8n-workflow profiles.

## 3.6.0

### Minor Changes

- 806601e: Automatic AI Hub → MCP Server wiring: Hub emits a `wiring` block; MCP Server inherits forbidden names and max tool calls from input/`aiHubNodeName` when params stay at defaults. CI early format job, version-PR Check Runs, Linux baseline calibration artifact, staging e2e hub, pack-size warnings, and expanded socket unit coverage.

## 3.5.0

### Minor Changes

- cfa54a4: Improve Plug MCP Server / AI Hub UX and harden capability governance: visual capability builder, validate operation (rejects admin capabilities), multi-item execution, capability-name dropdown, resource-mapper params, optional audit on output, pilot pack examples, stricter maxRows / filter / SQL-binding checks (string-literal aware), Tools staticParams precedence, blank required-string rejection, case-insensitive column masking on SQL and Tools, and tool-call budget defaulting omitted count to 1 when a max is set.

### Patch Changes

- e9d2a89: Speed up PayloadFrame HMAC verify (raw digest compare) and JSON parse (Buffer path), raise parallel chunk decode overlap to 8, and extend `bench:payload-frame:check` with async decode cases plus a refreshed baseline to catch performance regressions.
- e9d2a89: Harden Socket SQL/relay and Socket Event Trigger: serialize relay executes per agent, defer transport dispose under refcount, map classic batch accept failures, clean batch response listeners on timeout, reject orphaned parallel chunk decodes, serialize trigger reconnects with single circuit accounting, fix dropOldest with maxQueueSize=0, persist event-id dedupe across reconnects, and recreate idle sockets on JWT rotation.

## 3.4.0

### Minor Changes

- f5b0f51: Improve socket/relay throughput and streaming reliability: overlap PayloadFrame chunk decodes with ordered merge, strip stream_id once, cache accepted hub request ids, sync encode tiny stream-pull frames, soft-JWT auth update without reconnect, and aggregate seeded streams inside relay batches. Automatically omit relay fastPath for all sql.execute / sql.executeBatch commands so inadvertent agent streams can pull reliably. Align workspace/docs to Node 24.18.0.

## 3.3.1

### Patch Changes

- 7aca81c: Harden Plug MCP Hub governance and execution: SELECT-only SQL capabilities, unified effective maxRows for truncation, forbidden/admin capability filtering on tools/list and tools/call, friendly error mapping without technical leaks, Tools provider support in MCP Server V1, AI Hub maxToolCallsPerTurn clamping, and optional per-turn tool-call budget enforcement on the MCP Server.
- 8837c10: Harden Plug server communication retries and socket safety: no double-execution on socket timeouts or agents:command→relay fallback after emit; auto-omit relay fastPath for streaming-capable commands; refresh TOKEN_EXPIRED without HTTP status; fix stream credit races and pull abort accounting; clear stuck Socket Event Trigger reconnecting flag; gate Client/User Access transient retries to safe list/get ops; map HTTP timeouts to PlugTimeoutError; parse Retry-After HTTP-dates and cap delays; treat RPC -32013 as retryable; align consumer/relay app:error retryable codes; trim PayloadFrame signature key_id on encode.

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
