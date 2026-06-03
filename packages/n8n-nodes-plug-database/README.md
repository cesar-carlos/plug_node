# n8n-nodes-plug-database

![Plug Database logo](https://raw.githubusercontent.com/cesar-carlos/plug_node/main/assets/app_icons/plug_connect-blockchain-512px.png)

`n8n-nodes-plug-database` is the canonical Plug Database package for n8n.

## Installation

```bash
npm install n8n-nodes-plug-database@3.1.0
```

Latest: **3.1.0** — see [CHANGELOG](./CHANGELOG.md) and [UX decisions for 3.1.0](../../docs/ux-decisions.md#310-workflow-visible-changes).

## What This Package Does

- REST and consumer Socket command execution
- client-to-agent access management over REST
- guided mode for common operations
- advanced mode for raw JSON-RPC commands
- Socket Event publish over REST or Socket
- one-shot Socket Event waiting over `/consumers`
- `Plug Database Socket Event Trigger`
- `Plug Database Plura.ai Automations Trigger`
- document, image, code/identity, data, security, date/value, Plug-specific, barcode, and PDF tools under `Resource = Tools`

This package now contains the surface that used to live in `n8n-nodes-plug-database-advanced`. The advanced package should be deprecated on npm after this major release.

## Included Nodes

- `Plug Database`
  - consolidated node with `Resource = SQL | Client Access | User Access | Tools`
- `Plug Database Socket Event Trigger`
  - listens for `client:custom.*` events or `client:agent.profile.updated`
- `Plug Database Plura.ai Automations Trigger`
  - receives webhook events when a Plura.ai automation node executes

The two trigger nodes are intentionally separate n8n nodes. n8n activates triggers through `trigger()` or webhook lifecycle methods, while `Plug Database` runs normal workflow executions through `execute()`. Socket waiting and publishing operations are available inside `Plug Database > Resource = Tools`, but continuous triggers must remain separate for n8n activation, deactivation, and webhook registration.

The Plura.ai trigger display name is grouped under Plug Database for discoverability, but its internal node name intentionally remains `pluraAiAutomationsTrigger` so existing Plura workflows keep loading after the package consolidation.

## Supported Operations

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
- Socket events: `Publish Socket Event`, `Wait for Socket Event`

## Credentials

`Plug Database Account API` asks for:

- `User (email)`
- `Password`
- optional `Default Agent ID`
- optional `Default Client Token`
- optional `Payload Signing Key`
- optional `Payload Signing Key ID`

Credentials saved with older internal names are still selectable after upgrade. This package registers `plugDatabaseApi`, `plugDatabaseAdvancedApi`, `plugDatabaseClientApi`, and `plugDatabaseUserApi` as compatibility aliases that extend `plugDatabaseAccountApi`.

The SQL node can override `Agent ID` and `Client Token` per node. Resolution order is:

- node field
- credential default
- validation error only when the selected operation requires the missing value

The package uses the fixed API base URL:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## SQL Examples and Safe Mode

`Resource = SQL` uses guided placeholders as references instead of inserting an executable query automatically. Replace template markers such as `{{substitua_pela_tabela}}` before running the node.

For named parameters, use SQL placeholders and `Named Params JSON`:

```sql
SELECT TOP 10 *
FROM Cliente
WHERE CodCliente = :codCliente;
```

```json
{
  "codCliente": "{{$json.CodCliente}}"
}
```

Guided SQL and guided batch commands reject unreplaced template markers, missing named parameters, and `UPDATE` or `DELETE` statements without a `WHERE` clause. Turn off `Require WHERE for UPDATE/DELETE` only for workflows that intentionally perform a global mutation. Advanced JSON-RPC mode does not apply these guided-mode checks.

### Choosing SQL operations

| n8n operation       | Hub method         | When to use                                                                       |
| ------------------- | ------------------ | --------------------------------------------------------------------------------- |
| **Execute SQL**     | `sql.execute`      | One statement (or several result sets with **Multi Result** on the same SQL text) |
| **Execute Batch**   | `sql.executeBatch` | Several independent commands in one RPC (`commands[]` array)                      |
| **Bulk Insert SQL** | `sql.bulkInsert`   | High-volume inserts with column schema + row matrix (mutating)                    |

Do not confuse **Multi Result** (`sql.execute` + `options.multi_result`) with **Execute Batch** (`sql.executeBatch`). They use different hub contracts.

**Bulk Insert SQL** sends `sql.bulkInsert` with JSON column definitions and row arrays (mutating). Use a dedicated staging table and idempotency keys in production.

**Prefer DB Streaming** (SQL options) sets `options.prefer_db_streaming` for eligible `SELECT` statements when using Socket.

**Empty results:** with **Aggregated JSON**, zero SQL rows produce one item with `rowCount: 0` and `__plug.emptyResult: true` so workflows can continue. See [Hub contract alignment](../../docs/hub-contract-alignment.md).

## Performance and reliability

See [Performance and reliability](../../docs/performance-and-reliability.md) for channel choice, ERP keys (`CodCliente` / `CodVendedor`), socket buffering, automatic transient retries, and optional **Coalesce Input Items** on Execute Batch.

`Plura.ai Automations API` asks for:

- `Email`
- `Password`
- optional `API Key`

## Socket Compatibility

- `Resource = SQL` with `Channel = Socket` prefers `agents:command` on `/consumers`.
- When the server does not answer the newer consumer Socket transport, the runtime falls back to relay for single-command flows.
- `Execute Batch` over Socket requires `agents:command`; use REST or upgrade the server when the server does not support it.
- Custom Socket Events can be published over REST or Socket.
- `Wait for Socket Event` uses `/consumers`, `socket:event.subscribe`, and best-effort unsubscribe.
- `Plug Database Socket Event Trigger` supports reconnect controls, backpressure controls, optional PayloadFrame signature enforcement, and eventId deduplication.

## Migration From Advanced

This is a major release. Saved workflows that reference removed advanced node type names must be migrated:

- `plugDatabaseAdvanced` -> `plugDatabase`
- `plugDatabaseAdvancedSocketEventTrigger` -> `plugDatabaseSocketEventTrigger`
- `plugDatabaseAdvancedPdf` and `plugDatabaseAdvancedBarcode` -> `Plug Database` with `Resource = Tools`

Legacy credential aliases remain supported, so saved credentials can still be selected after the node migration.

For exported n8n workflow JSON files, run a dry run first and then write changes after reviewing the output:

```bash
npm run migrate:workflows -- ./workflow.json
npm run migrate:workflows -- --write ./workflow.json
```

The migrator also rewrites legacy credential keys on nodes to `plugDatabaseAccountApi`. Use `--check` in CI to fail when an export still needs migration. With `--write`, `--backup` keeps a `.bak` copy of each overwritten file, and `--output-dir <dir>` writes migrated JSON without touching the originals.

After upgrading, uninstall `n8n-nodes-plug-database-advanced` from the n8n instance and restart n8n. If old `Plug Database Advanced` menu entries still appear, reload the community node cache or reinstall `n8n-nodes-plug-database` so n8n indexes the canonical package only.

## Tool Runtime Notes

PDF tools use `Browser Channel = Auto` by default. Auto uses Playwright Chromium through `@playwright/browser-chromium`, then common installed Chrome/Chromium paths if the bundled browser is unavailable. If npm install scripts are disabled or `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` is set, provide a browser with `Browser Executable Path` or `PLUG_TOOLS_BROWSER_EXECUTABLE_PATH`.

Use n8n's built-in `Compression`, `Convert to File`, and `Extract From File` nodes for gzip, base64, and generic file conversion.

## Documentation

- [Workspace overview](https://github.com/cesar-carlos/plug_node/blob/main/README.md)
- [Project summary](https://github.com/cesar-carlos/plug_node/blob/main/docs/project-summary.md)
- [Communication patterns](https://github.com/cesar-carlos/plug_node/blob/main/docs/communication-patterns.md)
- [Socket guide](https://github.com/cesar-carlos/plug_node/blob/main/docs/socket/README.md)
- [Custom Socket Events](https://github.com/cesar-carlos/plug_node/blob/main/docs/socket/custom-events.md)
- [Client Access](https://github.com/cesar-carlos/plug_node/blob/main/docs/client-access.md)
- [User Access](https://github.com/cesar-carlos/plug_node/blob/main/docs/user-access.md)
- [Workflow examples](https://github.com/cesar-carlos/plug_node/blob/main/docs/workflow-examples.md)
