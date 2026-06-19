# Performance and Reliability

Guidance for running the Plug Database n8n node efficiently and safely against the Plug hub and ERP SQL Server schemas.

## Channel and response mode

| Scenario                               | Recommendation                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Small reads, CRUD, smoke tests         | **REST** + **Aggregated JSON**                                                                        |
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

`streamPullWindowSize` (0–1000) controls how many chunks are requested per pull window. Use **0** for adaptive mode (agent `recommendedStreamPullWindowSize`, clamped to 1000). When the agent does not advertise a recommendation, the internal fallback is **256**, aligned with the hub default.

## Relay Fast Path

Enable **Relay Fast Path** under **Socket Options** (`fastPath: true`) for relay transport workloads where the hub supports unary fast-path routing. This skips `relay:rpc.accepted` on the happy path and routes responses by JSON-RPC body `id`. Prefer it for cross-agent relay RPC and unary workloads where latency matters. See `plug_server/docs/relay_fastpath_study.md` for hub-side trade-offs.

**Request Server Timings** (`requestServerTimings: true` in Socket Options) asks the hub to include server-side phase timings in relay responses when supported.

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
