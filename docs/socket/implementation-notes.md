# Socket implementation notes (English)

This file holds repository-internal details for maintainers of the monorepo. User-facing operational documentation is in Portuguese under this folder ([README](./README.md), [glossary](./glossary.md), [custom events](./custom-events.md), [examples](./examples.md), [troubleshooting](./troubleshooting.md)).

## Internal architecture

Shared contracts live in `shared/contracts/custom-socket-events.ts`:

- event name validation
- attachment and publisher guards
- REST publish response guard
- socket subscribe/unsubscribe ACK guard
- socket publish ACK guard
- profile push payload guard

Socket lifecycle helpers live in `shared/socket/customSocketEventSession.ts`:

- `publishCustomSocketEventOverSocket`
- `waitForCustomSocketEvent`
- `startCustomSocketEventSession`
- `startAgentProfileUpdatedSession`

The canonical package provides only the Socket.IO transport adapter. The shared layer owns validation, correlation, timeout handling, HMAC policy, and user-safe error classification.

Socket error classification lives in `shared/socket/socketErrors.ts`. Keep token refreshability, terminal auth codes, `connect_error`, and `app:error` mapping there instead of duplicating it across relay, `agents:command`, and custom event sessions.

`agents:command` envelopes include `protocolVersion` as an explicit client protocol marker. The current value is `2026-05-14`; keep socket fixtures and server-facing documentation aligned when this changes.

Socket command results expose correlation counters in `__plug.metrics` when Plug metadata is included. These counters are intended for production troubleshooting of stale responses, ignored stream chunks, ignored stream completes, ignored stream pull responses, accepted chunks, pull requests, and local buffer usage.

Protocol fixtures live in `tests/fixtures/socketProtocolFixtures.ts`, with regression coverage in `tests/internal/socketProtocolContracts.test.ts`. Update those fixtures when the server contract changes.

After changing `shared`, run `npm run sync-shared`. Do not manually edit files under `packages/*/generated/shared`.

## Shared helpers introduced in 3.0.0

The audit hardening release added a few internal helpers that future contributors should reuse instead of re-implementing the same patterns:

- `shared/rest/parseHelpers.ts` — `assertRecord`, `assertString`, `assertNumber`, `assertStringArray`, `assertRecordArray`, `assertOptionalString`. Centralizes REST response validation. Use these instead of inline guards when wiring a new REST list / detail endpoint.
- `packages/n8n-nodes-plug-database/nodes/PlugDatabase/socketIoTransport.ts` — `createSocketIoTransport({ baseUrl, accessToken, namespace })` returns a transport object that implements the `connect / disconnect / on / off / emit` surface required by `RelaySocketTransport`, `ConsumerSocketTransport` and `CustomSocketEventTransport`. Use it instead of writing yet another wrapper around `socket.io-client`.
- `shared/rest/resourceClient.ts` — `collectAllPages` is bounded by `MAX_COLLECT_PAGES = 100` and throws `PlugError({ code: "COLLECT_PAGES_LIMIT_EXCEEDED" })` when exceeded. Document the bound when adding new aggregated list endpoints.
- `shared/socket/relaySession.ts` / `shared/socket/consumerCommandSession.ts` — chunk-row merging uses `tryMergeChunkRowsIntoRawRpcResponse` (relay) and `tryMergeChunkRowsIntoConsumerResponse` (consumer). They append rows **in place** on the existing `rows` array; strip `stream_id` once when the stream starts (not per chunk). Do not refactor merges to `concat`/spread.
- `shared/socket/parallelChunkDecode.ts` — bounded overlapping PayloadFrame/wire decodes with ordered merge (`MAX_PARALLEL_CHUNK_DECODES`). Use this instead of a fully serial `.then` chain when adding stream handlers.
- `shared/utils/json.ts` — `stringifyJson` replaces the misleading `safeStringify`. Use it explicitly when you need to estimate UTF-8 byte size or build canonical JSON.
- `shared/contracts/errors.ts` — `PlugValidationError` and `PlugTimeoutError` now accept the full `PlugErrorOptions` shape (including `technicalMessage`, `description`, `correlationId`, `retryable`). Pass options as the second argument; extra keys go into `details` automatically.

## Operational limits

The server currently fans out custom socket events only to sockets connected to the same Plug Server replica unless the deployment adds a distributed Socket.IO adapter. Workflows that require cross-replica delivery should publish through infrastructure that guarantees affinity or use a deployment with distributed socket fan-out.

Do not log payload JSON, binary base64, access tokens, refresh tokens, client tokens, passwords, SQL, or payload signing keys. The nodes only add safe metadata to outputs.

## Connection model

Each node execution that uses `Channel = Socket` opens a Socket.IO connection through `ManagedSocketIoTransport`. Within the same executor instance the transport is reused across items when healthy. Soft JWT refresh updates `socket.auth.token` without reconnecting. There is **no persistent connection pool across separate n8n executions**. Implications:

- The first Socket command in an execution incurs connect + `connection:ready` (typically < 200 ms on LAN, higher on WAN); later items on the same managed transport skip that when the socket stays connected.
- Soft token rotation no longer forces a full reconnect solely because the access token string changed.
- When many **separate** executions run in parallel each holds its own connection for the duration of the command.
- The `connectTimeoutMs` is always capped to `commandTimeoutMs`, so a very low `Timeout (MS)` on the node also constrains how long the client waits for `connection:ready`.
- For high-frequency, low-latency use cases, prefer `Execute Batch` (single connection, multiple commands) over multiple individual executions, or use `Channel = REST` when sub-second latency is not critical.
- Failed relay commands end the conversation even when conversation reuse is enabled, so agent stream capacity is released.

The `commandTimeoutMs` behaves as an **idle timer**, not a wall-clock deadline. It resets on every incoming event (chunk, response, stream pull ACK). A slow stream that produces one chunk every N seconds will keep resetting the timer as long as N < `commandTimeoutMs`. There is currently no separate maximum-total-duration limit at the transport layer.

## Performance notes and known constraints

### Capability probe and token rotation

`ConsumerSocketExecutionManager` caches the `agents:command` capability check with a 60-second TTL. The cache key is the `/consumers` **namespace URL** only (not the access token). Soft JWT refresh keeps the live Socket.IO transport and calls `updateAccessToken`; a fresh capability probe is skipped while the TTL is still valid for that URL. Homogeneous replicas share the same capability surface; if replicas can diverge, shorten the TTL or force a reconnect that clears the manager.

### Parallel subscribe and unsubscribe in `startCustomSocketEventSession`

`startCustomSocketEventSession` emits all `socket:event.subscribe` requests concurrently and awaits their ACKs with `Promise.allSettled`. On close, `unsubscribeBestEffort` likewise unsubscribes in parallel. Each `waitForControlAck` filters by `requestId` and `eventName`, so concurrent control messages do not interfere. Startup latency is therefore O(RTT) rather than O(N × RTT).

### Chunk decode overlaps; merge stays ordered

`relayStreamAggregation` and `consumerCommandSession` use `createParallelChunkDecodeQueue`: up to `MAX_PARALLEL_CHUNK_DECODES` (4) PayloadFrame/wire decodes may run concurrently, while row merge, credit accounting, and stream pulls stay on an ordered chain. Prefetch when remaining credits fall to ≤ 25% of the last granted window (`shouldPrefetchStreamPull`). Tiny stream-pull control frames use sync `encodePayloadFrame` with `compression: "none"`.

### Buffer estimation on non-PayloadFrame wire messages

`estimateConsumerWireBytes` uses a fast path when the wire message is a `PayloadFrame` envelope — it reads `originalSize` directly without any deserialization. If the server sends raw JSON responses (not wrapped in `PayloadFrame`), the fallback calls `JSON.stringify` + `Buffer.byteLength` on the decoded data. Maintain the fast path invariant: every new server-side endpoint that replies with `PayloadFrame` avoids the fallback cost. If adding a new response type that cannot use `PayloadFrame`, document the expected response size and consider whether the buffer limit check is still meaningful.

### Stream row merge is append-in-place (intentional mutation)

`tryMergeChunkRowsIntoConsumerResponse` and `tryMergeChunkRowsIntoRawRpcResponse` mutate the initial response's `rows` array by pushing chunk rows one at a time. This is O(n) without allocation overhead per chunk. Strip `stream_id` once when the stream starts (or on complete for older paths), not on every chunk. Do not refactor to `concat` or spread, as that would allocate a new array per chunk (quadratic memory in the number of chunks).

### Relay batch items that open streams

`executeRelayBatchCommand` continues with `waitForRelayStreamAggregation({ seededResponse })` when a batch item response includes `result.stream_id`, so batch SQL that streams is pulled and aggregated instead of hanging on the unary response only.

## Troubleshooting

See [troubleshooting](./troubleshooting.md) for symptoms, error codes, and recommended actions.
