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
  - consolidated node with `Resource = SQL | Client Access | User Access`
- `Plug Database Advanced PDF`
  - renders trusted HTML strings to PDF binary data
- `Plug Database Advanced Barcode`
  - generates QR codes and barcodes as PNG or SVG binary data
- `Plug Database Advanced Socket Event`
  - publishes `client:custom.*` events over REST or `/consumers`
- `Plug Database Advanced Socket Event Trigger`
  - listens for `client:custom.*` events or `client:agent.profile.updated`

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

`Plug Database Advanced PDF`:

- `HTML to PDF`

`Plug Database Advanced Barcode`:

- `Generate Code`

`Plug Database Advanced Socket Event`:

- `Publish Event`

`Plug Database Advanced Socket Event Trigger`:

- `Custom Events`
- `Agent Profile Updated`

## Credentials

The credential asks for:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`

The SQL node can override `Agent ID` and `Client Token` per node. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

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
- The event Trigger supports queue/backpressure controls, optional required PayloadFrame signatures, and the internal `client:agent.profile.updated` push.

Legacy access-only nodes remain published for compatibility with existing workflows, but are hidden from the node creator for new users.

## Tool nodes

`Plug Database Advanced PDF` uses `playwright-core` and requires Chrome or Chromium to be available in the n8n runtime. Set `Browser Executable Path`, set `PLUG_TOOLS_CHROME_EXECUTABLE_PATH`, or use an installed browser channel.

For Docker-based n8n deployments, install Chrome or Chromium in the image and set `PLUG_TOOLS_CHROME_EXECUTABLE_PATH` to the executable path. `playwright-core` does not download a browser at install time.

Example Debian-based Docker layer:

```dockerfile
USER root
RUN apt-get update \
  && apt-get install -y --no-install-recommends chromium \
  && rm -rf /var/lib/apt/lists/*
ENV PLUG_TOOLS_CHROME_EXECUTABLE_PATH=/usr/bin/chromium
USER node
```

For Alpine-based images, use `apk add --no-cache chromium` and set `PLUG_TOOLS_CHROME_EXECUTABLE_PATH=/usr/bin/chromium-browser` when that is the installed executable path.

For safety, the PDF node accepts HTML strings only, supports optional CSS injection, disables JavaScript by default, blocks external network requests, and always blocks `file:` URLs. It also exposes `PDF Media`, `Wait Until`, `Render Delay (ms)`, `Max HTML Size Bytes`, and `Max PDF Output Size Bytes` controls for larger templates.

Deployment owners can enforce tighter upper bounds with:

- `PLUG_TOOLS_MAX_HTML_SIZE_BYTES`
- `PLUG_TOOLS_MAX_PDF_OUTPUT_SIZE_BYTES`
- `PLUG_TOOLS_MAX_BARCODE_TEXT_SIZE_BYTES`
- `PLUG_TOOLS_MAX_BARCODE_OUTPUT_SIZE_BYTES`

`Plug Database Advanced Barcode` uses `@bwip-js/node` and supports QR Code, Code 128, EAN, UPC, Data Matrix, PDF417, and Aztec output. EAN and UPC inputs are validated before rendering. PNG and SVG binary output include optional metadata with size and duration, and QR/barcode output can also be emitted as JSON base64 when needed. Use `Metadata Property` and `Base64 Output Property` when the default JSON fields would collide with upstream item fields.

Use n8n's built-in `Compression`, `Convert to File`, and `Extract From File` nodes for gzip, base64, and generic file conversion.

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Communication patterns](https://github.com/cesar-carlos/plug_node/blob/main/docs/communication-patterns.md)
- [Custom Socket Events](https://github.com/cesar-carlos/plug_node/blob/main/docs/custom-socket-events.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
