---
"n8n-nodes-plug-database": major
---

Audit hardening release. Three-pass review against the project rules. 28
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
