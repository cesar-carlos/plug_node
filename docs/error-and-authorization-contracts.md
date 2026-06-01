# Error and Authorization Contracts

The Plug Database node surfaces errors from three layers: the REST API, the agent JSON-RPC envelope, and the node runtime itself. All categories share the same `PlugError` shape exposed in `continueOnFail` output (see [Output of continueOnFail](#output-of-continueonfail)).

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

Terminal authorization codes that stop the node without retrying:

- `ACCOUNT_BLOCKED`
- `AGENT_ACCESS_REVOKED`

## Session refresh and retry behavior

Within a single node execution, the shared session runner:

| Step | Behavior |
| ---- | -------- |
| Login | One deduplicated `POST /client-auth/login` (or `/auth/login` for user credentials) per execution runner. |
| Proactive refresh | When the access JWT `exp` is within about 60 seconds, `POST .../refresh` runs before the next command. Concurrent refresh calls share one in-flight request. |
| Reactive refresh | On a refreshable auth error (`401`, or token-related `403` such as `TOKEN_EXPIRED`), one refresh and one callback retry per runner invocation. |
| Login fallback | If refresh returns `401`, one additional login with the stored credential password and one more callback retry. |
| Not retried | Business `403` responses (for example agent permission denied), `429` rate limits, and terminal auth codes. |

HTTP `429` responses keep the user-facing message `Plug rate limited this request.` and include the server rate-limit text in `description` when the API provides it, plus `Retry-After` guidance when present.

## SQL validation behavior

Observed SQL validation failures include:

- malformed statements
- unsupported pagination combinations
- invalid multi-result combinations
- driver-level syntax errors

The node shows a clear user-facing message first and preserves technical details for support and debugging metadata.

## Node-side error codes

The node also raises its own `PlugError` codes for runtime conditions that are not produced by the server. These codes are stable and can be matched in `Switch` / `IF` nodes that branch on `continueOnFail` output.

| Code                              | When it fires                                                                                                                            | Recommended action                                                                              |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `PLUG_VALIDATION_ERROR`           | Local guard rejected an input before sending it (missing required field, invalid JSON, unreplaced template marker, unsafe UPDATE/DELETE) | Fix the node parameters or the upstream item.                                                   |
| `PLUG_TIMEOUT`                    | Local timeout while waiting for an HTTP response or a socket event                                                                       | Increase `Timeout (MS)` or check infrastructure latency.                                        |
| `HTTP_RESPONSE_MISSING_STATUS`    | The underlying n8n HTTP helper returned a response without a numeric `statusCode` (introduced in 3.0.0)                                  | Retry the run. If it persists, capture network logs and report — the response is malformed.     |
| `COLLECT_PAGES_LIMIT_EXCEEDED`    | A REST list endpoint returned more than 100 pages while the node was collecting all of them (introduced in 3.0.0)                        | Paginate manually with `page` / `pageSize` or narrow the query.                                 |
| `SOCKET_BUFFER_LIMIT`             | A Socket SQL stream exceeded the local buffer guardrails (max chunks, rows, or bytes)                                                    | Reduce `Max Rows`, paginate the query, switch to `Chunk Items`, or split the workflow.          |
| `SOCKET_STREAM_ABORTED`           | The Socket SQL stream was aborted by the server before completion                                                                        | Inspect `completePayload` for the server reason and retry, or reduce the query cost.            |
| `SOCKET_STREAM_ERROR`             | The Socket SQL stream ended with `terminal_status = error`                                                                               | Inspect `completePayload` for the agent error and retry, or reduce the query cost.              |
| `RELAY_CONVERSATION_START_FAILED` | The relay conversation could not be started for a Socket command                                                                         | Check `/consumers` availability and the server logs; the node falls back to REST when possible. |
| `SOCKET_CONNECT_ERROR`            | Socket.IO handshake failed                                                                                                               | See [Socket troubleshooting](./socket/troubleshooting.md#erros-de-conex%C3%A3o).                |
| `SOCKET_DISCONNECTED`             | Socket dropped during a command or while listening                                                                                       | Retry the workflow or rely on the trigger reconnect logic.                                      |

## Output of continueOnFail

When the node is configured with `Continue On Fail`, errors are serialized into the next item as `json.error` with a stable shape:

```json
{
  "error": {
    "message": "user-facing message",
    "description": "actionable hint when available",
    "code": "PLUG_VALIDATION_ERROR",
    "statusCode": 400,
    "correlationId": "uuid-from-server-or-request",
    "retryable": false,
    "retryAfterSeconds": 30
  }
}
```

This shape is identical whether the failure happened during the request, the response parsing, or the post-processing pipeline. Use it to branch on `code` in downstream nodes.
