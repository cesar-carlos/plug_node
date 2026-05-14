# Workflow Examples

## Validate access

Use `Validate Context` as a quick end-to-end check for:

- login
- agent access
- client token acceptance

## Query rows over REST

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
SELECT *
FROM Cliente
WHERE id = :id
LIMIT 10;
```

- Named Params JSON:

```json
{
  "id": "{{$json.id}}"
}
```

- response mode: `Aggregated JSON`

Expected result: one n8n item per returned row.

## Query rows with page-based pagination

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
SELECT *
FROM Cliente
WHERE cidade = :cidade
ORDER BY id;
```

- Named Params JSON:

```json
{
  "cidade": "{{$json.cidade}}"
}
```

- Additional Options:
  - Page: `1`
  - Page Size: `100`

Expected result: the first page of rows matching the current n8n item.

## Insert a row with parameters

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
INSERT INTO Cliente (nome, email)
VALUES (:nome, :email);
```

- Named Params JSON:

```json
{
  "nome": "{{$json.nome}}",
  "email": "{{$json.email}}"
}
```

Expected result: the agent response for the insert command.

## Update a row safely

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
UPDATE Cliente
SET email = :email
WHERE id = :id;
```

- Named Params JSON:

```json
{
  "id": "{{$json.id}}",
  "email": "{{$json.email}}"
}
```

`Require WHERE for UPDATE/DELETE` is enabled by default and blocks updates without a `WHERE` clause.

## Delete a row safely

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
DELETE FROM Cliente
WHERE id = :id;
```

- Named Params JSON:

```json
{
  "id": "{{$json.id}}"
}
```

Leave `Require WHERE for UPDATE/DELETE` enabled unless the workflow intentionally performs a global mutation.

## Execute a basic batch

Use `Plug Database` with:

- operation: `Execute Batch`
- Batch Commands JSON:

```json
[
  {
    "sql": "UPDATE Cliente SET email = :email WHERE id = :id",
    "params": {
      "id": "{{$json.id}}",
      "email": "{{$json.email}}"
    }
  },
  {
    "sql": "SELECT * FROM Cliente WHERE id = :id",
    "params": {
      "id": "{{$json.id}}"
    }
  }
]
```

Expected result: the normalized batch response. Each batch command is checked for unreplaced template markers, missing named parameters, and unsafe `UPDATE` or `DELETE` statements.

## Query rows over Socket

See [Socket examples](./socket/examples.md), the [glossary](./socket/glossary.md), and the importable workflows under [`docs/socket/examples/`](./socket/examples/) for SQL Socket, publish, wait, and trigger patterns.

Use `Plug Database` with:

- operation: `Execute SQL`
- channel: `Socket`
- response mode: `Aggregated JSON` or `Chunk Items`

Expected result: normalized JSON output with optional chunk emission for streaming responses.

## Generate a PDF document

Use `Plug Database` with:

- node: `Plug Database`
- resource: `Tools`
- operation: `HTML to PDF`
- HTML: an HTML string from a previous node or an expression
- CSS: optional inline stylesheet for the rendered document
- browser: `Browser Executable Path`, `PLUG_TOOLS_CHROME_EXECUTABLE_PATH`, or an installed Chrome channel
- PDF options: set `PDF Media`, `Wait Until`, `Render Delay (ms)`, and output size limits for larger templates
- metadata: set `Metadata Property` if the input JSON already uses `__plugTools`

Expected result: the input JSON is preserved and the generated PDF is attached as n8n binary data.

## Generate a QR code or barcode

Use `Plug Database` with:

- node: `Plug Database`
- resource: `Tools`
- operation: `Generate Barcode`
- barcode type: `QR Code` for URLs or text, or a supported linear/2D barcode type
- output format: `PNG` for image workflows or `SVG` for vector output
- optional `Include Base64 JSON` when a downstream API needs a JSON string instead of binary data
- optional `Base64 Output Property` and `Metadata Property` to avoid overwriting existing JSON fields

Expected result: the input JSON is preserved and the generated image is attached as n8n binary data.

## Transform and validate payload data

Use `Plug Database` with:

- node: `Plug Database`
- resource: `Tools`
- operation: `Transform JSON` for JSONata projections, or `Validate JSON Schema` before sending payloads downstream
- output JSON property: defaults to `result`

Use these before SQL or access workflows when a workflow receives loose webhook data and needs a normalized, validated payload.

## Prepare files without standalone nodes

Use `Plug Database` with:

- node: `Plug Database`
- resource: `Tools`
- operations: document and image helpers such as `Merge PDFs`, `Extract PDF Text`, `Resize Image`, and `Create Thumbnail`
- binary input: `Binary Property`, default `data`
- binary output: `Output Binary Property`, default `data`

Use these helpers when the workflow needs file preparation close to Plug SQL, access, or socket-event logic.
