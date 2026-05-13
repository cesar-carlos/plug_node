# n8n-nodes-plug-database

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database` is the public Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database
```

## What this package does

- REST-only command execution
- client-to-agent access management over REST
- fixed Plug Database API base URL
- guided mode for common operations
- advanced mode for raw JSON-RPC commands
- Document, image, code/identity, data, security, date/value, Plug-specific, barcode, and REST socket-event publishing tools under `Resource = Tools`

This package is still REST-only, but it now includes local PDF and barcode tool runtime dependencies. Treat n8n Cloud verification as a separate compatibility check rather than assuming the package is Cloud-strict.

## Included nodes

- `Plug Database`
  - consolidated REST-only node with `Resource = SQL | Client Access | User Access | Tools`

## Supported operations

`Resource = SQL`:

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

`Resource = Client Access`:

- `List Client Agents`
- `Get Client Agent`
- `List Access Requests`
- `Request Agent Access`
- `Revoke Agent Access`
- `Get Client Token`
- `Set Client Token`

`Resource = User Access`:

- `List Agent Catalog`
- `List Access Requests`
- `Approve Access Request`
- `Reject Access Request`
- `List Agent Clients`
- `Revoke Agent Client Access`

`Resource = Tools`:

- Documents: `HTML to PDF`, `Markdown to PDF`, `Text to PDF`, `Merge PDFs`, `Split PDF`, `Extract PDF Text`
- Images: `Resize Image`, `Convert Image`, `Compress Image`, `Add Image Watermark`, `Create Thumbnail`
- Code and identity: `Generate Barcode`, `Read Barcode`, `Validate CPF/CNPJ`, `Format CPF/CNPJ`, `Generate UUID`
- Data: `Transform JSON`, `CSV to JSON`, `JSON to CSV`, `Normalize Text`, `Extract Regex Fields`, `Validate JSON Schema`
- Security: `Generate Hash`, `HMAC Sign`, `Base64 Encode/Decode`, `JWT Decode`, `Encrypt Text`, `Decrypt Text`
- Dates and values: `Format Date`, `Parse Date`, `Add Business Days`, `Format Currency`, `Number to Words`
- Plug-specific: `Build Socket Event Payload`, `Validate Client Token`, `Validate Agent Context`, `Build SQL Request`, `Parse SQL Rows`, `Generate Access Request Summary`
- `Publish Socket Event` over REST

The PDF tools use `Browser Channel = Auto` by default. Auto uses Playwright Chromium through `@playwright/browser-chromium`, then common installed Chrome/Chromium paths if the bundled browser is unavailable, so Google Chrome is not required unless you explicitly select the Chrome browser channel. If npm install scripts are disabled or `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set, provide a browser with `Browser Executable Path` or `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH`.

## Credentials

`Plug Database Account API` asks for:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`
- optional `Payload Signing Key`
- optional `Payload Signing Key ID`

The SQL node can override `Agent ID` and `Client Token` per node. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Output modes

- `Aggregated JSON`
- `Raw JSON-RPC`
- optional `Include Plug Metadata`

`Execute SQL` returns one n8n item per row when the response contains tabular rows.

Both access nodes also support:

- `Return All` for paginated listing operations
- optional `Include Plug Metadata`
- standardized summary items with `success`, `operation`, `resourceType`, `resourceId`/`resourceIds`, and `raw`

## Quick examples

- Use `Plug Database` with `Resource = Client Access` to request access to several agents with repeated `Agent ID` rows instead of raw JSON arrays.
- Use `Plug Database` with `Resource = Client Access` and `Return All` to fetch the full approved-agent list in one step.
- Use `Plug Database` with `Resource = SQL` and credential defaults for the common agent, then override `Agent ID` or `Client Token` only in the steps that need a different target.
- Use `Plug Database` with `Resource = User Access` to review pending access requests, then approve or reject each request by `Request ID`.
- Use `Plug Database` with `Resource = User Access` to list clients approved for one agent and revoke a single `Client ID` when necessary.

## Limitations

- no Socket relay support
- no realtime trigger in v1
- `Execute Batch` runs over REST only
- Socket Event publish uses REST only in this package
- install this package instead of the advanced package when you only want the REST-only node set

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
- [Release process](https://github.com/cesar-carlos/plug_node/blob/main/docs/release-process.md)
