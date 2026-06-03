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
SELECT TOP 10 *
FROM Cliente
WHERE CodCliente = :codCliente;
```

- Named Params JSON:

```json
{
  "codCliente": "{{$json.CodCliente}}"
}
```

- response mode: `Aggregated JSON`

Expected result: one n8n item per returned row.

## Zero rows (Aggregated JSON)

Use `Execute SQL` with **Aggregated JSON** when the query may return no rows (for example a filter that matches nothing):

```sql
SELECT *
FROM Vendedor
WHERE ISNULL(Customizado_BotWhatsapp_Permitido, 'N') = 'S'
  AND TRIM(ISNULL(Customizado_BotWhatsapp_Numero, '')) <> '';
```

Expected result: **one** output item:

```json
{
  "rowCount": 0,
  "rows": [],
  "__plug": { "emptyResult": true }
}
```

Branch downstream with `IF` on `$json.__plug?.emptyResult` or `$json.rowCount === 0` instead of relying on zero items (which stops the workflow by default).

For large result sets, prefer `Channel = Socket`, enable **Prefer DB Streaming** when available, and use **Chunk Items** response mode. See [Socket SQL](./socket/sql-socket.md).

## Execute Batch (read-only smoke)

Use **Execute Batch** when the hub should run **multiple commands** in one `sql.executeBatch` RPC (not the same as **Multi Result** on a single SQL string).

- operation: `Execute Batch`
- Batch Commands JSON:

```json
[{ "sql": "SELECT TOP 5 * FROM Cliente" }, { "sql": "SELECT TOP 5 * FROM Vendedor" }]
```

- response mode: `Raw JSON-RPC` for debugging, or `Aggregated JSON` when the agent returns a single summarized payload

Use read-only `SELECT` statements in examples and staging. For mutating batches, enable transaction options only when the agent profile supports them.

## Execute Batch with coalesced input items

When several upstream items each carry a small batch payload, enable **Coalesce Input Items** under batch **Additional Options** so the node issues one `sql.executeBatch` call.

- Item 0 `Batch Commands JSON`:

```json
[{ "sql": "SELECT TOP 1 * FROM Cliente" }]
```

- Item 1 `Batch Commands JSON`:

```json
[{ "sql": "SELECT TOP 1 * FROM Vendedor" }]
```

Use the same **Additional Options** on every item. The node returns one output item with `__plug.coalescedItemCount` when metadata is enabled.

## Query rows with page-based pagination

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
SELECT *
FROM Cliente
WHERE cidade = :cidade
ORDER BY CodCliente;
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
WHERE CodCliente = :codCliente;
```

- Named Params JSON:

```json
{
  "codCliente": "{{$json.CodCliente}}",
  "email": "{{$json.email}}"
}
```

`Require WHERE for UPDATE/DELETE` is enabled by default and blocks updates without a `WHERE` clause.

## Bulk insert rows

Use `Bulk Insert SQL` for high-volume inserts via `sql.bulkInsert` (mutating — use a staging table).

- Table: `dbo.MyStagingTable`
- Columns JSON:

```json
[
  { "name": "id", "type": "i64" },
  { "name": "name", "type": "text" }
]
```

- Rows JSON:

```json
[
  [1, "Alpha"],
  [2, "Beta"]
]
```

Prefer idempotency keys in Additional Options when retrying workflows.

## Delete a row safely

Use `Plug Database` with:

- operation: `Execute SQL`
- SQL:

```sql
DELETE FROM Cliente
WHERE CodCliente = :codCliente;
```

- Named Params JSON:

```json
{
  "codCliente": "{{$json.CodCliente}}"
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
    "sql": "UPDATE Cliente SET email = :email WHERE CodCliente = :codCliente",
    "params": {
      "codCliente": "{{$json.CodCliente}}",
      "email": "{{$json.email}}"
    }
  },
  {
    "sql": "SELECT TOP 10 * FROM Cliente WHERE CodCliente = :codCliente",
    "params": {
      "codCliente": "{{$json.CodCliente}}"
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

## Encrypt and decrypt a value across executions

Use `Plug Database > Tools > Encrypt Text` to encrypt sensitive data, persist the full envelope, and decrypt it later in another execution or workflow.

Encrypt step:

- node: `Plug Database`
- resource: `Tools`
- operation: `Encrypt Text`
- text: the plaintext to protect
- passphrase: a strong passphrase from a secret store

Output (3.0.0):

```json
{
  "ciphertext": "...",
  "iv": "...",
  "salt": "...",
  "tag": "...",
  "algorithm": "aes-256-gcm",
  "iterations": 600000
}
```

Persist the **entire** envelope (including `iterations`) in your storage. Pass it back to `Decrypt Text` later:

- operation: `Decrypt Text`
- encryptedJson: the full envelope captured above
- passphrase: same passphrase used to encrypt

The `iterations` field is read from the envelope, so payloads written by 2.x (without `iterations`) still decrypt under the legacy 120000 default. New payloads use 600000 PBKDF2 iterations (OWASP 2023 alignment).

## Validate input with a JSON Schema

Use `Plug Database > Tools > Validate JSON Schema` to ensure inputs match a contract before sending them downstream.

- node: `Plug Database`
- resource: `Tools`
- operation: `Validate JSON Schema`
- data: the JSON to validate (often `{{$json}}`)
- schema: a JSON object or a boolean (`true` accepts anything; `false` rejects everything)

Example schema:

```json
{
  "type": "object",
  "required": ["id", "email"],
  "properties": {
    "id": { "type": "string" },
    "email": { "type": "string", "format": "email" }
  }
}
```

Output:

```json
{
  "valid": true,
  "errors": []
}
```

When `valid` is `false`, `errors` contains the Ajv error list. Boolean schemas (`true` / `false`) are accepted since 3.0.0.

## Parse a permissive CSV

Use `Plug Database > Tools > CSV to JSON` for CSV inputs that may have rows of varying width.

- node: `Plug Database`
- resource: `Tools`
- operation: `CSV to JSON`
- csv: the CSV text (often from a previous binary node)
- options: `header = true`, `skipEmptyLines = true`

Since 3.0.0 the tool tolerates `FieldMismatch` warnings (rows with more or fewer fields than the header). Only fatal Papa Parse errors abort the parse, so real-world CSVs with stray rows still come through.
