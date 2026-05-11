# UX Decisions

## Credential model

The node keeps a single simple credential:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

The API base URL is fixed in code.

## Public vs advanced package

### Public package

- REST-only
- no Socket options in the UI
- includes Tools operations without Socket publish
- includes local PDF and barcode runtime dependencies, so Cloud verification is not assumed from the package name alone

### Advanced package

- explicit `Channel = REST | Socket`
- `Chunk Items` output mode
- includes Tools operations with REST or Socket publish where applicable
- npm-only distribution

## Output behavior

- `Execute SQL`
  - returns one item per row when possible
- `Raw JSON-RPC`
  - available for debugging and advanced workflows
- `Include Plug Metadata`
  - enabled by default

## Error presentation

- prefer user-facing API messages
- hide low-level technical errors from the primary message
- preserve correlation and retry metadata for debugging
