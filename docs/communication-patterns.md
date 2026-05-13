# Communication Patterns

## REST flow

1. Login with `/client-auth/login`.
2. Reuse the access token inside the execution.
3. Refresh once with `/client-auth/refresh` when authentication expires.
4. Execute commands through `/agents/commands`.
5. Normalize JSON-RPC responses into n8n-friendly JSON output.

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

See [Socket guide](./socket/README.md) for SQL over Socket, custom events, trigger behavior, PayloadFrame, examples, troubleshooting, and shared-code maintenance notes. The older [Custom Socket Events](./custom-socket-events.md) page remains as a focused reference for the custom event surface.

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
  - available on the Socket-enabled `Plug Database` node
