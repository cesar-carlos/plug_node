# Custom Socket Events

The advanced package exposes the Plug Server custom event surface through two n8n nodes:

- `Plug Database Advanced Socket Event` publishes `client:custom.*` events.
- `Plug Database Advanced Socket Event Trigger` listens for custom events or the internal `client:agent.profile.updated` push.

The normative server contract lives in the Plug Server docs under `plug_server/docs`. This document records how the n8n package maps that contract into node fields and shared code.

## Publisher Node

`Plug Database Advanced Socket Event` has one operation, `Publish Event`.

Use `Publish Channel = REST` for the compatible default. It sends `POST /api/v1/client/me/socket-events` with JSON when no attachments are configured, and `multipart/form-data` when attachments are present.

Use `Publish Channel = Socket` when the workflow should publish over `/consumers`. The node connects with the current client session token, waits for `connection:ready`, emits `socket:event.publish`, and correlates `socket:event.published` by `requestId`.

Supported fields:

- `Event Name`: must match `client:custom.[A-Za-z0-9._:-]` and the server length limit.
- `Payload JSON`: required; `null` is valid.
- `Payload Frame Compression`: passed to Plug as `default`, `none`, or `always`.
- `Idempotency Key`: optional, max 128 chars, `[A-Za-z0-9._:-]`.
- `Attachments`: optional binary property names from the incoming n8n item.
- `Timeout (MS)`: HTTP timeout or socket publish ACK timeout.
- `Include Plug Metadata`: adds a safe `__plug` object.

Attachment behavior:

- REST sends an `event` JSON form field plus one `files` part per binary property.
- Socket sends inline attachments as `{ fieldName, originalName, mimeType, sizeBytes, base64 }`.
- Socket attachments are convenient for small payloads but remain subject to the server JSON envelope limit. Prefer REST multipart for larger files.

The output keeps the server response fields and adds `__plug.channel = "rest" | "socket"` when metadata is enabled.

## Trigger Node

`Plug Database Advanced Socket Event Trigger` connects to `/consumers` and emits one item per event.

`Event Source = Custom Events` subscribes to exact `client:custom.*` names using `socket:event.subscribe` and unsubscribes best-effort on close. Wildcards are intentionally not exposed because the server subscribes exact names.

`Event Source = Agent Profile Updated` listens directly for `client:agent.profile.updated` and does not send custom subscribe or unsubscribe messages.

Backpressure options:

- `Max Inflight Events`: concurrent n8n item preparation, default `8`.
- `Max Queue Size`: queued events while inflight work is busy, default `128`.
- `Overflow Policy`: `Fail`, `Drop Newest`, or `Drop Oldest`.

Security options:

- `Require Payload Signature`: when enabled, inbound `PayloadFrame` objects without `signature` are rejected.
- If a credential has `Payload Signing Key`, signed inbound frames are verified with HMAC-SHA256.
- If `Payload Signing Key ID` is set, signed inbound frames must match it.

Reliability behavior:

- Activation uses retry/backoff for retryable connection failures when reconnect is enabled.
- Runtime `disconnect`, `connect_error`, and retryable `app:error` events are classified and routed through the same reconnect policy.
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
- `startCustomSocketEventSession`
- `startAgentProfileUpdatedSession`

The advanced package provides only the Socket.IO transport adapter. The shared layer owns validation, correlation, timeout handling, HMAC policy, and user-safe error classification.

After changing `shared`, run `npm run sync-shared`. Do not manually edit files under `packages/*/generated/shared`.

## Operational Limits

The server currently fans out custom socket events only to sockets connected to the same Plug Server replica unless the deployment adds a distributed Socket.IO adapter. Workflows that require cross-replica delivery should publish through infrastructure that guarantees affinity or use a deployment with distributed socket fan-out.

Do not log payload JSON, binary base64, access tokens, refresh tokens, client tokens, passwords, SQL, or payload signing keys. The nodes only add safe metadata to outputs.
