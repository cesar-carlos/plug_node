# Communication Patterns

## REST flow

1. Login with `/client-auth/login`.
2. Reuse the access token inside the execution.
3. Refresh with `/client-auth/refresh` when the access token is near expiry (about 60 seconds before JWT `exp`) or when a refreshable auth error occurs (typically `401`, or token-related `403`).
4. On refresh `401`, retry once with a fresh login using the credential email and password.
5. Execute commands through `/agents/commands`.
6. Normalize JSON-RPC responses into n8n-friendly JSON output.

## Socket relay flow

`Plug Database` opens a Socket.IO connection to `/consumers` for the execution only when `Channel = Socket`.

Flow:

1. Login and obtain tokens.
2. Connect to `/consumers`.
3. Wait for `connection:ready`.
4. Start a relay conversation.
5. Send a single relay RPC request.
6. Collect response, chunks, and completion payloads.
7. Decode binary frames and gzip payloads.
8. Normalize the final response to JSON.
9. Close the conversation and socket.

## Custom Socket Events

Custom Socket Events also use `/consumers`. `Plug Database` can publish through REST or `socket:event.publish`, wait one-shot for the first matching `client:custom.*` event inside `Tools`, enforces server-aligned local payload limits before sending, and the trigger listens to exact `client:custom.*` names or the internal `client:agent.profile.updated` push.

The normative guide for custom socket events is [docs/socket/custom-events.md](./socket/custom-events.md). See the [Socket guide index](./socket/README.md) for SQL over Socket, trigger behavior, PayloadFrame, examples, troubleshooting, and shared-code maintenance notes.

## PayloadFrame handling

- supports `cmp: none | gzip`
- validates size and inflation limits
- returns normalized JSON to the workflow user

## Output rules

- `Execute SQL`
  - one n8n item per row when rows are present
- `Execute Batch`
  - normalized raw JSON by default
- `Raw JSON-RPC`
  - preserves the normalized RPC envelope
- `Chunk Items`
  - available when `Channel = Socket` on `Plug Database > Resource = SQL`; emits each stream chunk as its own item without aggregating
