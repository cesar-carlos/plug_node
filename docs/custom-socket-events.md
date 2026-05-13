# Custom Socket Events

For the complete Socket documentation, including SQL over Socket, trigger lifecycle, PayloadFrame, examples, and troubleshooting, see [Socket no Plug Database](./socket/README.md).

The canonical package exposes the Plug Server custom event surface through the consolidated Tools resource and the realtime trigger:

- `Plug Database` with `Resource = Tools` and `Operation = Publish Socket Event` publishes `client:custom.*` events.
- `Plug Database` with `Resource = Tools` and `Operation = Wait for Socket Event` opens a one-shot `/consumers` listener for one `client:custom.*` event.
- `Plug Database Socket Event Trigger` listens for custom events or the internal `client:agent.profile.updated` push.

All three authenticated entry points use the shared `Plug Database Account API` credential.

The normative server contract lives in the Plug Server docs under `plug_server/docs`. This document records how the n8n package maps that contract into node fields and shared code.

## Publisher Node

`Plug Database` has one socket-event publisher operation under `Resource = Tools`: `Publish Socket Event`.

Use `Publish Channel = REST` for the compatible default. It sends `POST /api/v1/client/me/socket-events` with JSON when no attachments are configured, and `multipart/form-data` when attachments are present.

Use `Publish Channel = Socket` when the workflow should publish over `/consumers`. The node connects with the current client session token, waits for `connection:ready`, emits `socket:event.publish`, and correlates `socket:event.published` by `requestId`.

Supported fields:

- `Event Name`: must match `client:custom.[A-Za-z0-9._:-]` and the server length limit.
- `Payload JSON`: required; `null` is valid.
- `Payload Frame Compression`: passed to Plug as `default`, `none`, or `always`.
- `Idempotency Key`: optional, max 128 chars, `[A-Za-z0-9._:-]`.
- `Attachments`: optional binary property names from the incoming n8n item.
- `Timeout (MS)`: HTTP timeout for REST publishing.
- `Socket ACK Timeout (MS)`: socket connection and `socket:event.published` ACK timeout when publishing over Socket.
- `Include Plug Metadata`: adds a safe `__plug` object.

Attachment behavior:

- REST sends an `event` JSON form field plus one `files` part per binary property.
- Socket sends inline attachments as `{ fieldName, originalName, mimeType, sizeBytes, base64 }`.
- The node mirrors the server defaults locally: max `5` attachments, `524288` bytes per file, `2097152` bytes total, and `524288` UTF-8 bytes for `Payload JSON`.
- Socket attachments are convenient for small payloads but remain subject to the server JSON envelope limit. Prefer REST multipart for larger files.

The output keeps the server response fields, including `requestId` and `idempotentReplay`, and adds `__plug.channel = "rest" | "socket"` when metadata is enabled.
For socket publishing, `__plug.publisherSocketId` is included when the local socket id is available.
`__plug.deliveryStatus = "delivered" | "noRecipients"` distinguishes between accepted publishes that matched at least one subscriber and accepted publishes that matched none.

## Wait Operation

`Plug Database` also has `Resource = Tools` and `Operation = Wait for Socket Event` for workflows that need to wait inline instead of activating a trigger.

Behavior:

- connects to `/consumers` with the current client session token
- waits for `connection:ready`
- emits `socket:event.subscribe` for one exact `client:custom.*` event name
- waits for the first matching event after the subscribe ACK
- emits `socket:event.unsubscribe` best-effort and closes the socket on success, error, or timeout
- does not reconnect automatically; retry belongs to the n8n workflow

Supported fields:

- `Event Name`: required exact `client:custom.*` event name.
- `Listen Timeout (MS)`: maximum time to wait for the first matching event after subscription, default `30000`, max `300000`.
- `Socket ACK Timeout (MS)`: timeout for `connection:ready`, subscribe ACK, and unsubscribe ACK phases, default `10000`.
- `Binary Property Prefix`: prefix for generated n8n binary properties from inline attachments, default `attachment`.
- `Require Payload Signature`: requires signed inbound PayloadFrames. The credential must include `Payload Signing Key`; otherwise execution fails before opening the socket.
- `Include Plug Metadata`: adds `json.__plug` with safe socket metadata.

The output includes `eventId`, `eventName`, `emittedAt`, `publisher`, `payload`, and attachment metadata without base64. Inline attachments are converted to n8n binaries such as `binary.attachment_0`.

When metadata is enabled, `json.__plug` includes `channel = "socket"`, `operation = "waitForSocketEvent"`, `socketId`, `receivedAt`, `payloadFrameRequestId`, `subscriptionCount`, and `attachmentCount`.

Timeout phases are intentionally separate:

- `Socket ACK Timeout (MS)` covers socket readiness and control ACKs. Failures use the standard socket timeout/error codes.
- `Listen Timeout (MS)` starts after subscription succeeds. If no matching event arrives, the node fails with `SOCKET_EVENT_LISTEN_TIMEOUT` unless `continueOnFail` is enabled.

## Trigger Node

`Plug Database Socket Event Trigger` connects to `/consumers` and emits one item per event.

`Event Source = Custom Events` subscribes to exact `client:custom.*` names using `socket:event.subscribe` and unsubscribes best-effort on close. Wildcards are intentionally not exposed because the server subscribes exact names.

`Event Source = Agent Profile Updated` listens directly for `client:agent.profile.updated` and does not send custom subscribe or unsubscribe messages.

Backpressure options:

- `Max Inflight Events`: concurrent n8n item preparation, default `8`.
- `Max Queue Size`: queued events while inflight work is busy, default `128`.
- `Overflow Policy`: `Fail`, `Drop Newest`, or `Drop Oldest`.
- Drop counters and current queue/inflight counts are included in `json.__plug.backpressure` on emitted items.

Security options:

- `Require Payload Signature`: when enabled, inbound `PayloadFrame` objects without `signature` are rejected.
- `Require Payload Signature For`: scopes signature enforcement to all event sources, custom events only, or `client:agent.profile.updated` only.
- If a credential has `Payload Signing Key`, signed inbound frames are verified with HMAC-SHA256.
- If `Payload Signing Key ID` is set, signed inbound frames must match it.

Deduplication options:

- `Deduplicate Events`: ignores duplicate custom events with the same `eventId`.
- `Deduplication TTL (MS)`: how long emitted custom event IDs stay in the in-memory cache. This is local to the n8n process and only applies to `Event Source = Custom Events`.

Reliability behavior:

- Activation uses retry/backoff for retryable connection failures when reconnect is enabled.
- Runtime `disconnect`, `connect_error`, and retryable `app:error` events are classified and routed through the same reconnect policy.
- `Max Reconnect Failures in Window` and `Reconnect Failure Window (MS)` provide an optional reconnect circuit breaker. Keep the max at `0` to preserve unlimited retry behavior.
- `ACCOUNT_BLOCKED` and `AGENT_ACCESS_REVOKED` are auth-related permanent errors.
- `NAMESPACE_DEPRECATED` is permanent.
- `CONSUMER_SOCKET_INITIALIZATION_FAILED`, `ROOM_JOIN_FAILED`, `SOCKET_CONNECT_ERROR`, and transient disconnects are retryable.

Custom event output:

- `json.eventId`
- `json.eventName`
- `json.emittedAt`
- `json.publisher`
- `json.payload`
- `json.attachments` without base64
- `binary.attachment_0`, `binary.attachment_1`, etc. for inline attachments

Profile push output:

- `json.eventName = "client:agent.profile.updated"`
- `json.payload` with the decoded profile update payload

When `Include Plug Metadata` is enabled, `json.__plug` includes safe operational metadata such as `channel`, `socketMode`, `eventName`, `eventId` when present, `receivedAt`, `socketId`, `reconnectAttempt`, `subscriptionCount`, and `payloadFrameRequestId`.
For custom events it also includes `backpressure` counters.

## Internal Architecture

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

After changing `shared`, run `npm run sync-shared`. Do not manually edit files under `packages/*/generated/shared`.

## Operational Limits

The server currently fans out custom socket events only to sockets connected to the same Plug Server replica unless the deployment adds a distributed Socket.IO adapter. Workflows that require cross-replica delivery should publish through infrastructure that guarantees affinity or use a deployment with distributed socket fan-out.

Do not log payload JSON, binary base64, access tokens, refresh tokens, client tokens, passwords, SQL, or payload signing keys. The nodes only add safe metadata to outputs.

## Troubleshooting

| Symptom / code                               | Meaning                                                                                       | Action                                                                                                |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `PAYLOAD_TOO_LARGE` or local size validation | Payload JSON or attachments exceed the server-aligned limits.                                 | Reduce payload size, split attachments, or use REST multipart for file-heavy events.                  |
| `RATE_LIMITED`                               | REST or Socket publish rate limit was exceeded.                                               | Respect `retryAfterSeconds` when present and reduce publish frequency.                                |
| `SUBSCRIPTION_LIMIT_EXCEEDED`                | The socket subscribed to more custom event names than the server allows.                      | Reduce exact event subscriptions or split workflows/sockets.                                          |
| `SOCKET_EVENT_LISTEN_TIMEOUT`                | `Wait for Socket Event` subscribed successfully but no matching event arrived before timeout. | Increase `Listen Timeout (MS)`, publish after the listener starts, or let n8n retry the step.         |
| `Payload Signing Key is required`            | `Require Payload Signature` is enabled for the wait operation but the credential has no key.  | Configure `Payload Signing Key` or disable required signatures for this step.                         |
| `PayloadFrame signature is required`         | `Require Payload Signature` is enabled but the server sent an unsigned frame for that source. | Scope `Require Payload Signature For` or configure server-side signing.                               |
| `SOCKET_EVENT_BACKPRESSURE_LIMIT`            | The trigger queue is full and `Overflow Policy = Fail`.                                       | Increase queue/inflight limits, lower event volume, or choose a drop policy.                          |
| `SOCKET_RECONNECT_CIRCUIT_OPEN`              | Too many retryable reconnect failures happened in the configured window.                      | Check server/network health, then raise or disable the circuit breaker if unlimited retry is desired. |
