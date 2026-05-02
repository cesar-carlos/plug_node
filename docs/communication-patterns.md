# Communication Patterns

## REST flow

1. Login with `/client-auth/login`.
2. Reuse the access token inside the execution.
3. Refresh once with `/client-auth/refresh` when authentication expires.
4. Execute commands through `/agents/commands`.
5. Normalize JSON-RPC responses into n8n-friendly JSON output.

## Socket relay flow

The advanced package opens a Socket.IO connection to `/consumers` for the execution only.

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
  - advanced package only
