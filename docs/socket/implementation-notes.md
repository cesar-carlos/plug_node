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

## Troubleshooting

See [troubleshooting](./troubleshooting.md) for symptoms, error codes, and recommended actions.
