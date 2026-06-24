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
- `shared/socket/relaySession.ts` / `shared/socket/consumerCommandSession.ts` — chunk-row merging is now done via `tryMergeChunkRowsIntoResponse` (relay) and `tryMergeChunkRowsIntoNormalizedResponse` (consumer). They return a new object instead of mutating the active response; preserve the immutable pattern when extending the streaming path.
- `shared/utils/json.ts` — `stringifyJson` replaces the misleading `safeStringify`. Use it explicitly when you need to estimate UTF-8 byte size or build canonical JSON.
- `shared/contracts/errors.ts` — `PlugValidationError` and `PlugTimeoutError` now accept the full `PlugErrorOptions` shape (including `technicalMessage`, `description`, `correlationId`, `retryable`). Pass options as the second argument; extra keys go into `details` automatically.

## Operational limits

The server currently fans out custom socket events only to sockets connected to the same Plug Server replica unless the deployment adds a distributed Socket.IO adapter. Workflows that require cross-replica delivery should publish through infrastructure that guarantees affinity or use a deployment with distributed socket fan-out.

Do not log payload JSON, binary base64, access tokens, refresh tokens, client tokens, passwords, SQL, or payload signing keys. The nodes only add safe metadata to outputs.

## Connection model

Each node execution that uses `Channel = Socket` opens a fresh Socket.IO connection and disconnects when the command completes. `ManagedSocketIoTransport` can reuse a transport within the same executor instance (same invocation scope), but there is **no persistent connection pool across executions**. Implications:

- Every SQL command via Socket incurs a connect + `connection:ready` handshake (typically < 200 ms on LAN, higher on WAN).
- When many executions run in parallel each holds its own connection for the duration of the command.
- The `connectTimeoutMs` is always capped to `commandTimeoutMs`, so a very low `Timeout (MS)` on the node also constrains how long the client waits for `connection:ready`.
- For high-frequency, low-latency use cases, prefer `Execute Batch` (single connection, multiple commands) over multiple individual executions, or use `Channel = REST` when sub-second latency is not critical.

The `commandTimeoutMs` behaves as an **idle timer**, not a wall-clock deadline. It resets on every incoming event (chunk, response, stream pull ACK). A slow stream that produces one chunk every N seconds will keep resetting the timer as long as N < `commandTimeoutMs`. There is currently no separate maximum-total-duration limit at the transport layer.

## Performance notes and known constraints

### Capability probe and token rotation

`ConsumerSocketExecutionManager` caches the `agents:command` capability check with a 60-second TTL. The cache key is `${namespaceUrl}:${accessToken}`. When the access token rotates (proactive renewal near `exp` or fallback login), the cache is invalidated and the next execution re-runs the probe (`rpc.discover`). This adds one extra round-trip after each token renewal. The token-in-key design is intentional: a new token may connect to a different server replica whose capability may differ. If all replicas are known to be homogeneous and stable, a future improvement could use `namespaceUrl` alone as the cache key to survive token rotation without re-probing.

### Sequential subscribe and unsubscribe in `startCustomSocketEventSession`

`startCustomSocketEventSession` subscribes to event names **one at a time**, awaiting the `socket:event.subscribed` ACK for each before emitting the next subscribe. For a trigger with N event names, startup latency is proportional to `N × roundTripMs`. Likewise, `unsubscribeBestEffort` (called on close) unsubscribes sequentially.

**Known improvement opportunity:** emit all subscribe requests in parallel and await all ACKs concurrently. Each `waitForControlAck` already filters by `requestId` and `eventName`, so concurrent subscribes would not interfere. This would reduce trigger startup from O(N × RTT) to O(RTT). Implementing this requires care around error handling (partial failure cleanup) and test coverage for concurrent ACKs.

### Chunk processing is serialized per session

`consumerCommandSession` processes chunks through a `chunkHandlerChain` — each chunk's async work is chained as `.then()` on the previous. This serializes payload frame decoding, row merging, and buffer limit assertions. The design is intentional: it preserves chunk ordering and prevents concurrent mutations of the aggregated response. For very high-throughput streams where chunk decoding is the bottleneck, a future improvement could offload heavy decoding to a worker thread. In practice, the stream pull back-pressure mechanism limits the concurrency at the transport level before this becomes a bottleneck.

### Buffer estimation on non-PayloadFrame wire messages

`estimateConsumerWireBytes` uses a fast path when the wire message is a `PayloadFrame` envelope — it reads `originalSize` directly without any deserialization. If the server sends raw JSON responses (not wrapped in `PayloadFrame`), the fallback calls `JSON.stringify` + `Buffer.byteLength` on the decoded data. Maintain the fast path invariant: every new server-side endpoint that replies with `PayloadFrame` avoids the fallback cost. If adding a new response type that cannot use `PayloadFrame`, document the expected response size and consider whether the buffer limit check is still meaningful.

### Stream row merge is append-in-place (intentional mutation)

`tryMergeChunkRowsIntoConsumerResponse` and `tryMergeChunkRowsIntoRawRpcResponse` mutate the initial response's `rows` array by pushing chunk rows one at a time. This is O(n) without allocation overhead per chunk. The implementation notes in shared say "preserve the immutable pattern when extending the streaming path" — that applies to the response object wrapper, not the `rows` array, which is intentionally mutated for throughput. Do not refactor to `concat` or spread, as that would allocate a new array per chunk (quadratic memory in the number of chunks).

## Troubleshooting

See [troubleshooting](./troubleshooting.md) for symptoms, error codes, and recommended actions.
