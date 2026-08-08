# Plug Database Changelog

All notable changes to this workspace will be documented in this file.

The format is based on Keep a Changelog and the project currently uses a lightweight manual process.

## [Unreleased]

### Changed

- Socket PayloadFrame hot path: HMAC verify compares raw digests; JSON parse accepts Buffer on Node 24; parallel chunk decode overlap raised to 8; `bench:payload-frame:check` covers async decode and uses a refreshed baseline to catch performance regressions.

### Added

- Plug MCP Server UX: Visual Builder (`authoringMode`), Validate Definitions operation, capability-name dropdown (`loadOptions`), resource-mapper params mode, `includeAuditInOutput` toggle, advanced-options disclosure, field notices, and numeric bounds on tool-call budget fields.
- MCP Hub examples: pilot capability pack (`docs/mcp-hub/examples/pilot-capabilities.json`) and importable reference workflow (`docs/mcp-hub/examples/mcp-hub-reference.workflow.json`).

### Fixed

- Plug MCP capability definition parsing: reject non-integer / non-finite `maxRows` and `minimum`/`maximum`, cross-validate `filterParamNames` and SQL `:bindings` against declared parameters, and keep flat-list `rowCount` aligned with filtered rows.
- Honor `limite`/`limit` when resolving `effectiveMaxRows` for Tools capabilities (truncation metadata now matches governance).
- Friendlier MCP `tools/call` error when the capability registry is empty.
- Deduplicate `normalizeJsonParameter` into shared JSON utils (MCP Server + AI Hub).
- MCP Hub hardening follow-ups: strip SQL string/comment literals when cross-checking `:bindings`; keep Tools `staticParams` above AI params; reject blank required strings; apply `maskedColumns` on Tools results (case-insensitive); treat explicit boolean `false` as an active filter; accept string integer `maxRows`; process all input items on MCP Server / AI Hub; fail `validate` when admin capabilities are present; default `toolCallCount` to `1` when a turn budget is set but the counter was omitted.

### Fixed (prior MCP hardenings)

- Harden Plug MCP Hub: enforce SELECT-only SQL capabilities, unify effective `maxRows` for hub + truncation metadata, filter forbidden/admin capabilities on `tools/list` and `tools/call`, map unmapped Plug errors to generic friendly messages (no technical leak), treat whitespace-only filter strings as inactive, and return MCP error envelopes (with audit) for forbidden capabilities and tool-call budget overruns.
- Enable Tools provider execution in MCP Server V1 via shared Plug Tools dispatch (with single-call input isolation).
- Clamp AI Hub `maxToolCallsPerTurn` to 1–20 and wire forbidden capability names / tool-call budget fields on MCP Server for workflow enforcement.

### Fixed (socket / transport)

- Socket reliability hardenings: serialize relay executes per `agentId`; defer managed-transport dispose while commands are in flight; map classic relay batch accept failures to per-item errors; always detach `relay:rpc.response` listeners/timers on batch timeout; reject orphaned parallel chunk-decode promises on clear; serialize trigger reconnect (no dual sockets); single circuit-breaker failure accounting; safe `dropOldest` with `maxQueueSize=0`; persist event-id dedupe across trigger reconnects; recreate idle sockets on JWT rotation; skip duplicate terminal listeners on consumer stream pull.
- Stop falling back from timed-out `agents:command` to relay (and stop transient-retrying Socket command timeouts) to avoid double-execution when the hub may still complete the original request.
- Omit relay `fastPath` automatically for streaming-capable commands (`prefer_db_streaming`, `multi_result`, `sql.executeBatch`) so the hub does not reject the combination.
- Treat socket auth codes such as `TOKEN_EXPIRED` / `INVALID_TOKEN` as refreshable even when `statusCode` is omitted on `app:error` / `connect_error`.
- Require an active stream id before accepting stream chunks and roll back in-flight pull accounting on pull failure (consumer and relay), preventing credit-window stalls.
- Clear the Socket Event Trigger `reconnecting` flag on fatal reconnect paths so later disconnects are not ignored.
- Limit Client/User Access transient HTTP retries to safe list/get operations; mutations (approve/revoke/set-token/request-access) are no longer blind-retried on 503/timeout.
- Map n8n HTTP timeouts / connection aborts to `PlugTimeoutError` so REST transient retries match documented behavior.
- Parse `Retry-After` HTTP-date values and cap retry delays at 60 seconds.
- Treat RPC `-32013` rate limits as retryable even when the agent sets `data.retryable: false`.
- Align consumer/relay `app:error` retryable codes with custom-event sessions (idle timeout, init failed, room join).
- Trim PayloadFrame HMAC `key_id` on encode to match verify-side trimming.

### Changed

- Align `docs/mcp-hub` with the implemented V1 model (inline `capabilityDefinitionsJson`, shared transport execution, audit on node output, Tools support).
- Documented Socket typeVersion 2 (`agents:command`) vs relay fallback, hub contract paths, capability-cache key (`namespaceUrl`), PayloadFrame `always` + 512 KiB gzip input cap, and Access/SQL retry safety notes.
- Updated architecture rule to describe both `/consumers` command paths (`agents:command` and `relay:*`).
- GitHub Actions now repairs Linux optional native bindings before running `npm run verify`.

### Documentation

- Reorganized `docs/socket`: slimmer `examples.md` (canonical JSON under `docs/socket/examples/`), cross-links between guides, optional glossary, post-import checklist, and automated relative link verification (`npm run verify:doc-links`).

### Added

- Workspace scaffolding for the public REST-only package and the advanced REST + Socket package.
- Shared auth, transport, socket, output, and n8n integration layers.
- Repository automation with CI, contribution templates, CODEOWNERS, and security guidance.
- Changesets-based version control, release workflow, and versioning documentation.
- Compatibility aliases for legacy Plug credential names: `plugDatabaseApi`, `plugDatabaseAdvancedApi`, `plugDatabaseClientApi`, and `plugDatabaseUserApi` now extend `plugDatabaseAccountApi`.

## [0.1.0] - 2026-05-01

### Added

- Initial Plug Database n8n workspace structure.
- Initial Plug Database workspace branding direction and package split.
- Project documentation under `docs/`.
