# Workflow Examples

## Validate access

Use `Validate Context` as a quick end-to-end check for:

- login
- agent access
- client token acceptance

## Query rows over REST

Use the public package with:

- operation: `Execute SQL`
- SQL: `SELECT * FROM Cliente`
- response mode: `Aggregated JSON`

Expected result: one n8n item per returned row.

## Query rows over Socket

Use the advanced package with:

- operation: `Execute SQL`
- channel: `Socket`
- response mode: `Aggregated JSON` or `Chunk Items`

Expected result: normalized JSON output with optional chunk emission for streaming responses.
