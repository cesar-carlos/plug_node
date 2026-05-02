# Error and Authorization Contracts

## REST API errors

REST endpoints may return HTTP errors such as:

- `400` validation problems
- `401` authentication failures
- `403` blocked or forbidden access
- `404` resource not found
- `429` rate limiting
- `503` temporary unavailability

The node prefers the most user-friendly message available and keeps structured metadata such as:

- `requestId`
- `retryable`
- `Retry-After`
- validation details

## Agent JSON-RPC errors

Agent command failures may arrive inside an HTTP `200` response with an RPC error payload.

Important fields used by the node:

- `code`
- `message`
- `data.reason`
- `data.category`
- `data.user_message`
- `data.technical_message`
- `data.correlation_id`
- `data.retryable`
- `data.retry_after_ms`

## Authorization behavior

The node injects the credential `Client Token` into supported commands.

Observed authorization behavior includes:

- permission failures such as `Not authorized`
- denied resource lists such as `denied_resources`
- token policy lookups through `client_token.getPolicy`

## SQL validation behavior

Observed SQL validation failures include:

- malformed statements
- unsupported pagination combinations
- invalid multi-result combinations
- driver-level syntax errors

The node shows a clear user-facing message first and preserves technical details for support and debugging metadata.
