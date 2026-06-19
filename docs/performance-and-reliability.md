# Performance and Reliability

Guidance for running the Plug Database n8n node efficiently and safely against the Plug hub and ERP SQL Server schemas.

## Channel and response mode

| Scenario                               | Recommendation                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Small reads, CRUD, smoke tests         | **REST** + **Aggregated JSON** (per-row) or **Aggregated Single Item** (one item with `rows[]`)       |
| Large `SELECT`                         | **Socket** (node typeVersion **2**) + **Prefer DB Streaming** + **Chunk Items** when needed           |
| Several independent statements         | **Execute Batch** (`sql.executeBatch`)                                                                |
| Several result sets in one SQL text    | **Execute SQL** + **Multi Result** (not batch)                                                        |
| Large lists without loading everything | Pagination (`page` + `pageSize`) with stable **`ORDER BY`** (for example `CodCliente`, `CodVendedor`) |

Socket typeVersion 2 reuses the consumer transport for all items in one node execution. Relay fallback reuses the relay transport the same way (conversation per command; socket stays connected when healthy).

## SQL conventions (ERP)

- Use **`TOP 1` or higher** — SQL Server does not accept `TOP 0`.
- **Cliente** primary key: `CodCliente` (not `id`).
- **Vendedor** primary key: `CodVendedor`.
- Paginated queries must include an explicit **`ORDER BY`** on a stable key.

## Socket buffering

Defaults (per item): 512 chunks, 50,000 rows, 8 MB. Tune under **Socket Options** when streaming large reports, or use **Chunk Items** to avoid holding the full result in memory.

`streamPullWindowSize` (0–1000) controls how many chunks are requested per pull window. Use **0** (default) for adaptive mode: the node omits an explicit window and lets the transport apply the agent `recommendedStreamPullWindowSize`, clamped to hub/agent max (fallback **256** when no hint is present). Set an explicit value (for example **512**) to override the agent recommendation up to the hub ceiling.

## Large result shaping (n8n output)

**Aggregated JSON** (default) emits **one n8n item per SQL row** when `result.rows` is present — large `SELECT`s can dominate CPU and memory in the workflow even after efficient socket streaming.

**Aggregated Single Item** emits **one n8n item** with `rowCount` and `rows[]` for SQL result sets. Use it when downstream nodes should process the full result set without per-row fan-out (for example a single Code node or HTTP request). Socket streaming still aggregates chunks in memory before output, same as Aggregated JSON.

For large reads:

- Prefer **Socket** + **Prefer DB Streaming** + **Chunk Items** response mode when you need bounded memory during transport, or
- Use **Aggregated Single Item** when the full result fits in memory but you want one workflow item, or
- Use pagination (`page` / `pageSize`) with a stable `ORDER BY`.

## Relay Fast Path

**Relay Fast Path** is **on by default** for typeVersion **1** relay nodes and in Socket Options (`fastPath: true`). It skips `relay:rpc.accepted` on the happy path and routes responses by JSON-RPC body `id`. Disable only when the hub requires classic accepted correlation. See `plug_server/docs/relay_fastpath_study.md` for hub-side trade-offs.

Relay command frames omit per-frame `traceId` on the hot path (aligned with hub high-throughput guidance); stream pulls already did this.

**Request Server Timings** (`requestServerTimings: true` in Socket Options) asks the hub to include server-side phase timings in relay responses when supported. With **Include Plug Metadata**, timings appear under `__plug.transport.serverTimings`:

- `phasesMs` — hub bridge phases (`consumer_frame_decode_ms`, `agent_to_hub_ms`, `relay_forward_to_consumer_ms`, …).
- `agentPhases.phasesMs` — agent sub-phases when the hub forwards `meta.agent_phases` (snake_case on the wire). When the hub merges agent timings into `phasesMs` with an `agent_` prefix, those keys appear in `phasesMs` directly.

Enable Socket Options → **Request Server Timings** on relay or typeVersion 2 socket runs. Agent-side per-phase breakdown (`plug_agente` roadmap item 4) is optional and not required for hub timings to appear.

## Relay client request id (fast path)

On relay, the JSON-RPC command `id` is the hub `client_request_id` used for idempotency and fast-path response routing (`body.id` echo). The node sets this from each command's JSON-RPC `id` (fresh per retry).

**`clientRequestIdEcho: "v1"`** is a proposed hub ↔ agent handshake extension ([`plug_server` ADR 0009](https://github.com/cesar-carlos/plug_server/blob/main/docs/adrs/0009-client-request-id-echo.md)) that would let the agent preserve `body.id` end-to-end without hub rewrite. Consumers do not send this flag; no node change is required until hub and agent negotiate the extension.

## Auto Performance Hints

**Auto Performance Hints** (default **on** in Execute SQL and Execute Batch **Additional Options**) applies performance suggestions only when you have not set the related option explicitly:

| Operation     | When hints apply (Socket / batch)             | Suggestion                                   |
| ------------- | --------------------------------------------- | -------------------------------------------- |
| Execute SQL   | Channel = **Socket**, eligible large `SELECT` | `options.prefer_db_streaming: true`          |
| Execute Batch | All commands are read-only `SELECT`           | `options.max_parallel_read_only_batch_items` |

Hints do **not** override explicit **Prefer DB Streaming**, **Max Parallel Read-Only Items**, or **Auto Performance Hints = off**.

## Bulk Insert limits

Bulk Insert is validated client-side before dispatch: at most **50,000** rows and ~**10 MiB** of serialized `table`/`columns`/`rows` JSON (hub `AGENT_SQL_BULK_INSERT_MAX_ROWS` / `AGENT_SQL_BULK_INSERT_MAX_JSON_BYTES`). Split larger loads into multiple node runs or batches manually; the node does not auto-chunk.

## Socket timeouts

- **Connect timeout** (default **10s**): waiting for `connection:ready` after opening `/consumers`.
- **Command idle timeout** (default **15s**, same as Request Timeout): resets on each `agents:command` response, stream chunk, stream complete, or stream pull window. A long stream stays alive while data arrives.

Tune Request Timeout under node options; connect timeout is capped by that value.

## Transient retries

The node automatically retries **up to three attempts** (initial + 2 retries) for:

- `executeSql`, `executeBatch`, `bulkInsertSql`, `cancelSql`
- `validateContext`, `discoverRpc`, `getAgentProfile`, `getClientTokenPolicy`

Retries apply to rate limits (`429`, RPC `-32013`), temporary unavailability (`503`), timeouts, and other `PlugError.retryable` cases. The node does **not** retry validation errors, auth failures, `replay_detected` (`-32014`), or `method_not_found`.

On retry, the node issues a **fresh JSON-RPC `id`** (and fresh socket `client_request_id` on relay fallback) so the hub replay guard does not block the retry. Keep **Idempotency Key** set when workflows must dedupe agent-side work.

When **Include Plug Metadata** is enabled, `__plug.transport` may include `attemptCount`, `lastRetryDelayMs`, and `connectedAfterMs` (socket).

## Idempotency and mutations

- Set **Idempotency Key** on SQL, batch, and bulk insert when workflows can retry.
- Keep **Require WHERE for UPDATE/DELETE** enabled unless a global mutation is intentional.
- Use business keys in `WHERE` clauses (`CodCliente`, not generic `id`).

## Coalesce Input Items (Execute Batch)

Enable **Coalesce Input Items** under batch **Additional Options** to merge `Batch Commands JSON` from every input item into **one** `sql.executeBatch` hub call.

- **Additional Options** must be identical on all items (compared to item 0).
- Maximum **100** commands after merge.
- The node returns **one** output item; `__plug.coalescedItemCount` records how many input items were merged.
- Failures apply to the whole batch (not per-item `continueOnFail` granularity).
- **Max Parallel Read-Only Items** and **Auto Performance Hints** control `max_parallel_read_only_batch_items` for read-only batches (see Auto Performance Hints above).

## Hub alignment

See [Hub contract alignment](./hub-contract-alignment.md) and [Workflow examples](./workflow-examples.md).

## Live testing

See [tests/e2e/README.md](../tests/e2e/README.md). Optional stress probe: `PLUG_E2E_STRESS_ENABLED=1 npm run test:e2e:stress`.
