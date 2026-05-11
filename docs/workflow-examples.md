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

## Generate a PDF document

Use the advanced package with:

- node: `Plug Database Advanced PDF`
- operation: `HTML to PDF`
- HTML: an HTML string from a previous node or an expression
- CSS: optional inline stylesheet for the rendered document
- browser: `Browser Executable Path`, `PLUG_TOOLS_CHROME_EXECUTABLE_PATH`, or an installed Chrome channel
- PDF options: set `PDF Media`, `Wait Until`, `Render Delay (ms)`, and output size limits for larger templates
- metadata: set `Metadata Property` if the input JSON already uses `__plugTools`

Expected result: the input JSON is preserved and the generated PDF is attached as n8n binary data.

## Generate a QR code or barcode

Use the advanced package with:

- node: `Plug Database Advanced Barcode`
- operation: `Generate Code`
- barcode type: `QR Code` for URLs or text, or a supported linear/2D barcode type
- output format: `PNG` for image workflows or `SVG` for vector output
- optional `Include Base64 JSON` when a downstream API needs a JSON string instead of binary data
- optional `Base64 Output Property` and `Metadata Property` to avoid overwriting existing JSON fields

Expected result: the input JSON is preserved and the generated image is attached as n8n binary data.
