# n8n-nodes-plug-database-advanced

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database-advanced` is the advanced Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database-advanced
```

## What this package adds

- `Channel = REST | Socket`
- consumer socket execution through `/consumers`
- `Chunk Items` output mode for socket streams
- client-to-agent access management over REST
- automatic capability probe for `agents:command`, with silent relay fallback for older saved workflows
- HTML-to-PDF generation for workflow documents
- QR code and barcode generation as n8n binary data

## Included nodes

- `Plug Database Advanced`
  - consolidated node with `Resource = SQL | Client Access | User Access | Tools`
- `Plug Database Advanced PDF` and `Plug Database Advanced Barcode`
  - hidden compatibility tool nodes
- `Plug Database Advanced Socket Event Trigger`
  - listens for `client:custom.*` events or `client:agent.profile.updated`
- `Plura.ai Automations Trigger`
  - receives webhook events when a Plura.ai automation node executes

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
- `Publish Socket Event` over REST or Socket
- `Wait for Socket Event` as a one-shot `/consumers` listener for the first matching `client:custom.*` event

`Plug Database Advanced Socket Event Trigger`:

- `Custom Events`
- `Agent Profile Updated`

`Plura.ai Automations Trigger`:

- `Workspace`
- `Journey`
- `Automation Node`

## Credentials

`Plug Database Account API` asks for:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`
- optional `Payload Signing Key`
- optional `Payload Signing Key ID`

Credentials saved with older internal names are still selectable after upgrade.
This package registers `plugDatabaseApi`, `plugDatabaseAdvancedApi`,
`plugDatabaseClientApi`, and `plugDatabaseUserApi` as compatibility aliases that
extend `plugDatabaseAccountApi`.

The SQL node can override `Agent ID` and `Client Token` per node. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

`Plura.ai Automations API` asks for:

- `Email`
- `Password`
- optional `API Key`

The Plura.ai trigger uses the email and password to load Workspace, Journey, and Automation Node options, then registers the n8n webhook with Plura.ai when the workflow is activated.

## Output modes

- `Aggregated JSON`
- `Chunk Items`
- `Raw JSON-RPC`
- optional `Include Plug Metadata`

Both access nodes also support:

- `Return All` for paginated listing operations
- standardized summary items with `success`, `operation`, `resourceType`, `resourceId`/`resourceIds`, and `raw`

## Notes

- this package is published to npm but is not intended for n8n verification
- it includes runtime dependencies for consumer socket transport, PDF rendering, and QR/barcode generation

## Quick examples

- Use `Plug Database Advanced` with `Resource = Client Access` to manage approved client agents and per-agent client tokens over REST.
- Use `Plug Database Advanced` with `Resource = User Access` to browse the agent catalog and approve or reject client access requests.
- Use `Plug Database Advanced` with `Resource = SQL` and credential defaults for the common target, then override `Agent ID` or `Client Token` only in the socket or REST steps that need a different agent.
- Use `Plug Database Advanced` with `Resource = SQL` when the workflow needs consumer socket execution or `Chunk Items` on SQL execution.

## Socket compatibility

- New executions with `Resource = SQL` and `Channel = Socket` prefer `agents:command` on `/consumers`.
- Older saved advanced workflows that were already using relay remain compatible without adding a new user-facing option.
- When the server does not answer the newer consumer socket transport, the runtime falls back to relay for single-command flows.
- `Execute Batch` over socket requires `agents:command`; when the server does not support it, use `REST` or upgrade the server.
- Large socket streams are protected by local buffer guardrails so the node fails clearly instead of letting memory grow without bounds.
- Custom Socket Events can be published over REST or Socket. REST is the compatible default; Socket uses `/consumers`, `socket:event.publish`, and `socket:event.published` ACK correlation.
- `Wait for Socket Event` uses `/consumers`, `socket:event.subscribe`, and best-effort unsubscribe for inline workflow steps that need a single event instead of a trigger.
- Wait operations have separate timeout phases: `Socket ACK Timeout (MS)` for connection/control ACKs and `Listen Timeout (MS)` for the first matching event after subscribe, capped at 300000 ms.
- Custom Socket Event attachments are locally checked against the server defaults: 5 files, 512 KiB per file, 2 MiB total, and 512 KiB payload JSON.
- The event Trigger supports queue/backpressure controls, optional per-source required PayloadFrame signatures, eventId deduplication, a configurable reconnect circuit breaker, and the internal `client:agent.profile.updated` push.

## Tool nodes

`Plug Database Advanced PDF` uses `Browser Channel = Auto` by default. Auto uses the Chromium browser downloaded by `@playwright/browser-chromium` during package installation, so Google Chrome is not required for the default PDF flow. If the Playwright-managed browser is unavailable, Auto also checks common installed Chrome/Chromium paths.

Do not install this package with npm scripts disabled, and do not set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`, unless your image provides a browser another way. If your deployment blocks Playwright browser downloads or runs offline, install Chromium in the image and set `Browser Executable Path` or `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH` to the executable path. `PLUG_TOOLS_CHROME_EXECUTABLE_PATH` is still supported as a compatibility alias.

Example Debian-based Docker layer:

```dockerfile
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*
ENV PLUG_TOOLS_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium
USER node
```

For Alpine-based images, use `apk add --no-cache chromium` and set `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH=/usr/bin/chromium-browser` when that is the installed executable path. To force Google Chrome or Microsoft Edge instead of Auto, set `Browser Channel` explicitly to `Chrome` or `Microsoft Edge`.

To smoke-test the real browser runtime locally or in a deployment image, run the test suite with `PLUG_TEST_REAL_PDF=1`. The smoke test is skipped by default because it launches Chromium and writes a real PDF buffer.

For safety, the PDF node accepts HTML strings only, supports optional CSS injection, disables JavaScript by default, blocks external network requests, and always blocks `file:` URLs. It also exposes `PDF Media`, `Wait Until`, `Render Delay (ms)`, `Max HTML Size Bytes`, and `Max PDF Output Size Bytes` controls for larger templates.

Deployment owners can enforce tighter upper bounds with:

- `PLUG_TOOLS_MAX_HTML_SIZE_BYTES`
- `PLUG_TOOLS_MAX_PDF_OUTPUT_SIZE_BYTES`
- `PLUG_TOOLS_MAX_BARCODE_TEXT_SIZE_BYTES`
- `PLUG_TOOLS_MAX_BARCODE_OUTPUT_SIZE_BYTES`

`Plug Database Advanced Barcode` uses `@bwip-js/node` and supports QR Code, Code 128, EAN, UPC, Data Matrix, PDF417, and Aztec output. EAN and UPC inputs are validated before rendering. PNG and SVG binary output include optional metadata with size and duration, and QR/barcode output can also be emitted as JSON base64 when needed. Use `Metadata Property` and `Base64 Output Property` when the default JSON fields would collide with upstream item fields.

Use n8n's built-in `Compression`, `Convert to File`, and `Extract From File` nodes for gzip, base64, and generic file conversion.

Do not treat simultaneous installation of `n8n-nodes-plug-database` and `n8n-nodes-plug-database-advanced` as a supported compatibility target. The advanced package carries the full authenticated Plug surface plus socket support, and both packages register the same internal Plug credential names, including the shared account credential and the legacy compatibility aliases.

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Communication patterns](https://github.com/cesar-carlos/plug_node/blob/main/docs/communication-patterns.md)
- [Custom Socket Events](https://github.com/cesar-carlos/plug_node/blob/main/docs/custom-socket-events.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
