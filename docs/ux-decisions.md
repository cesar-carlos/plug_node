# UX Decisions

## Credential model

The node keeps a single simple credential:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

The API base URL is fixed in code.

## Unified package

- `Plug Database` is the only visible database tool entry.
- SQL operations expose `Channel = REST | Socket`.
- Socket mode enables the `Chunk Items` output mode.
- Tools operations include REST and Socket Event publish where applicable.
- Local PDF and barcode runtime dependencies are included, so Cloud verification is not assumed from the package name alone.

## Tool catalog exposure

- only consolidated Plug nodes should appear in the n8n tool session
- `Plug Database` is the consolidated tool entry
- triggers and webhook-driven nodes stay workflow-only
- hidden compatibility wrappers stay workflow-only and must not create duplicate top-level tool entries
- event listening in tool sessions should go through `Plug Database > Tools > Wait for Socket Event`

## Output behavior

- `Execute SQL`
  - returns one item per row when possible
- `Raw JSON-RPC`
  - available for debugging and advanced workflows
- `Include Plug Metadata`
  - enabled by default

## Guided SQL UX

- guided SQL uses placeholders and descriptions as safe references instead of auto-filling an executable query
- examples use named parameters such as `:id` plus `Named Params JSON` values like `{{$json.id}}`
- guided SQL rejects unreplaced template markers before sending commands to Plug
- guided SQL checks that every `:name` placeholder has a matching key in `Named Params JSON`
- `Require WHERE for UPDATE/DELETE` is enabled by default for guided SQL and guided batch commands
- advanced JSON-RPC mode remains the escape hatch for intentional low-level commands

## Error presentation

- prefer user-facing API messages
- hide low-level technical errors from the primary message
- preserve correlation and retry metadata for debugging
