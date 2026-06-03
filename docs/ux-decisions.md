# UX Decisions

## Credential model

The node keeps a single simple credential:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

The API base URL is fixed in code.

## Unified package

- `Plug Database` is the only visible database tool entry.
- SQL operations expose `Channel = REST | Socket`.
- Socket mode enables the `Chunk Items` output mode.
- Tools operations include REST and Socket Event publish where applicable.
- Local PDF and barcode runtime dependencies are included, so Cloud verification is not assumed from the package name alone.

## Tool catalog exposure

- only consolidated Plug nodes should appear in the n8n tool session
- `Plug Database` is the consolidated tool entry
- triggers and webhook-driven nodes stay workflow-only
- hidden compatibility wrappers stay workflow-only and must not create duplicate top-level tool entries
- event listening in tool sessions should go through `Plug Database > Tools > Wait for Socket Event`

## Output behavior

- `Execute SQL`
  - returns one item per row when possible
  - when **Aggregated JSON** receives `rows: []`, returns **one** item with `rowCount: 0` and `__plug.emptyResult: true` so n8n does not stop the workflow with “no output data”
- `Raw JSON-RPC`
  - available for debugging and advanced workflows
- `Include Plug Metadata`
  - enabled by default

## Guided SQL UX

- guided SQL uses placeholders and descriptions as safe references instead of auto-filling an executable query
- examples use named parameters such as `:id` plus `Named Params JSON` values like `{{$json.id}}`
- guided SQL rejects unreplaced template markers before sending commands to Plug
- guided SQL checks that every `:name` placeholder has a matching key in `Named Params JSON`
- `Require WHERE for UPDATE/DELETE` is enabled by default for guided SQL and guided batch commands
- advanced JSON-RPC mode remains the escape hatch for intentional low-level commands

## Error presentation

- prefer user-facing API messages
- hide low-level technical errors from the primary message
- preserve correlation and retry metadata for debugging
- thrown `NodeOperationError` paths map `PlugError` through `toNodeFacingError()` so `technicalMessage` and `details` are not exposed on the primary error object (continue-on-fail JSON output is unchanged)

## 3.1.0 workflow-visible changes

Several reliability and performance changes shipped in `n8n-nodes-plug-database@3.1.0`. Most workflows benefit without edits; tune timeouts or options when a workflow relied on the previous edge behavior:

- **Separate connect timeout (default 10s).** Slow `connection:ready` on `/consumers` can fail before the SQL command starts, even when Request Timeout is higher. Increase **Request Timeout** under node options if handshakes are slow.
- **Command idle timeout resets during streaming.** Long reports stay alive while chunks or pull windows arrive; a hung stream still fails after the idle period. Workflows that assumed a single wall-clock timeout for the entire command may run longer when the hub keeps sending data.
- **Transient retries issue a fresh JSON-RPC `id`.** Retries avoid `replay_detected` (`-32014`). Workflows that depended on a fixed `id` in advanced JSON-RPC without **Idempotency Key** should set idempotency for mutations or accept a new id per attempt.
- **Execute Batch capability probe timeout no longer auto-runs consumer batch.** After probe timeout, the node returns a clear validation error instead of attempting batch on an unconfirmed hub. Use REST batch, upgrade the hub, or fix connectivity before batch socket runs.
- **Relay fallback uses a new command id** when consumer times out and relay runs, reducing duplicate in-flight commands on the hub.
- **Chunk Items skips full Aggregated JSON aggregation** in the output builder, so large streams do not build a full in-memory aggregate before chunking.
- **Legacy tools operation `publishEvent`** is routed again to socket event publish (workflows saved with that operation name keep working).
- **Socket Event Trigger backpressure** still drops events silently for `dropNewest` / `dropOldest` by default. A `reportDropAsError` hook exists in the queue helper for future node UI; until then, use `fail` overflow policy or monitor logs when the queue is saturated.

Hub SQL alignment in the same release (zero-row synthetic item, `sql.bulkInsert`, `prefer_db_streaming`, coalesce batch, transport metrics) is documented in [Hub contract alignment](./hub-contract-alignment.md) and [Performance and reliability](./performance-and-reliability.md).

## 3.0.0 breaking changes

Three workflow-visible changes shipped in `n8n-nodes-plug-database@3.0.0`. Existing workflows keep working in most cases but the items below may affect users that depend on the previous behavior:

- **`Plug Tools > Encrypt Text` envelope now carries `iterations`.** The runtime moved from 120.000 to 600.000 PBKDF2 iterations to align with OWASP 2023 guidance. The full envelope returned by `Encrypt Text` already includes the iteration count, so passing the entire envelope to `Decrypt Text` is sufficient. Workflows that persisted only `ciphertext` / `iv` / `salt` / `tag` from 2.x will keep decrypting under the legacy 120.000 default; ciphertexts produced by 3.0.0 require the new envelope (including `iterations`) to be decrypted.
- **`Plug Tools > Validate Client Token` `valid` flag is now consistent with warnings.** Tokens shorter than 16 characters now return `valid: false` together with a warning. The 2.x behavior was `valid: true` for short tokens. Workflows that branched on `valid === true` for short tokens must read the `warnings` array instead.
- **`Plug Database` HTTP transport now raises `HTTP_RESPONSE_MISSING_STATUS`.** When the underlying n8n HTTP helper returns a response without a numeric `statusCode`, the requester throws instead of silently assuming `200`. Workflows that intentionally depend on the previous lenient behavior should add `Continue On Fail` and branch on the new error code (see [Error and Authorization Contracts](./error-and-authorization-contracts.md#node-side-error-codes)).
