# Socket implementation notes (English)

This file holds repository-internal details that used to live in the root [Custom Socket Events](../custom-socket-events.md) guide. User-facing operational documentation is in Portuguese under this folder ([README](./README.md), [glossary](./glossary.md), [custom events](./custom-events.md), [examples](./examples.md), [troubleshooting](./troubleshooting.md)).

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

Protocol fixtures live in `tests/fixtures/socketProtocolFixtures.ts`, with regression coverage in `tests/internal/socketProtocolContracts.test.ts`. Update those fixtures when the server contract changes.

After changing `shared`, run `npm run sync-shared`. Do not manually edit files under `packages/*/generated/shared`.

## Operational limits

The server currently fans out custom socket events only to sockets connected to the same Plug Server replica unless the deployment adds a distributed Socket.IO adapter. Workflows that require cross-replica delivery should publish through infrastructure that guarantees affinity or use a deployment with distributed socket fan-out.

Do not log payload JSON, binary base64, access tokens, refresh tokens, client tokens, passwords, SQL, or payload signing keys. The nodes only add safe metadata to outputs.

## Troubleshooting

See [troubleshooting](./troubleshooting.md) for symptoms, error codes, and recommended actions.
