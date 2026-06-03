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

Socket typeVersion 2 reuses the consumer transport for all items in one node execution. Relay fallback (legacy hubs) reuses the relay transport the same way after this package version.

## SQL conventions (ERP)

- Use **`TOP 1` or higher** — SQL Server does not accept `TOP 0`.
- **Cliente** primary key: `CodCliente` (not `id`).
- **Vendedor** primary key: `CodVendedor`.
- Paginated queries must include an explicit **`ORDER BY`** on a stable key.

## Socket buffering

Defaults (per item): 512 chunks, 50,000 rows, 8 MB. Tune under **Socket Options** when streaming large reports, or use **Chunk Items** to avoid holding the full result in memory.

`streamPullWindowSize` (1–1000, default 32) controls how many chunks are requested per pull window.

## Transient retries

The node automatically retries **up to three attempts** (initial + 2 retries) for:

- `executeSql`, `executeBatch`, `bulkInsertSql`, `cancelSql`
- `validateContext`, `discoverRpc`, `getAgentProfile`, `getClientTokenPolicy`

Retries apply to rate limits (`429`, RPC `-32013`), temporary unavailability (`503`), timeouts, and other `PlugError.retryable` cases. The node does **not** retry validation errors, auth failures, `replay_detected` (`-32014`), or `method_not_found`.

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

## Hub alignment

See [Hub contract alignment](./hub-contract-alignment.md) and [Workflow examples](./workflow-examples.md).

## Live testing

See [tests/e2e/README.md](../tests/e2e/README.md). Optional stress probe: `PLUG_E2E_STRESS_ENABLED=1 npm run test:e2e:stress`.
