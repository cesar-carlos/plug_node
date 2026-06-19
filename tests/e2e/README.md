# E2E Tests

## Goal

Exercise the real Plug API and Socket consumer transport with credentials in `.env`.

## Required files

- `.env` (copy from `.env.example`, never commit)
- `.env.example` (tracked template)

For a dedicated socket agent, set `PLUG_E2E_SOCKET_AGENT_ID` and `PLUG_E2E_SOCKET_CLIENT_TOKEN`. When empty, the socket suite uses `PLUG_E2E_AGENT_ID` and `PLUG_E2E_CLIENT_TOKEN`.

## Commands

```bash
npm run test:e2e
npm run test:e2e:rest
npm run test:e2e:socket
npm run test:e2e:auth
npm run test:e2e:stress
npm run test:e2e:hub
npm run test:e2e:ci
npm run test:socket
```

`test:e2e:hub` runs only REST and Socket E2E files (batch, hub SQL options, cancel suites are registered there).

`test:e2e:ci` runs the CI smoke subset: live auth/session checks plus mocked custom socket event tests. It does not require `PLUG_E2E_DENIED_RESOURCE`.

E2E is **not** part of `npm run verify`. The suite runs sequentially (`fileParallelism: false`).

## CI / staging

GitHub Actions exposes an optional `e2e-staging` job in [`.github/workflows/ci.yml`](../../.github/workflows/ci.yml). It runs on **workflow_dispatch** only and uses repository secrets:

| Secret                  | Purpose                               |
| ----------------------- | ------------------------------------- |
| `PLUG_E2E_USER`         | Client login email                    |
| `PLUG_E2E_PASSWORD`     | Client login password                 |
| `PLUG_E2E_AGENT_ID`     | Default agent UUID                    |
| `PLUG_E2E_CLIENT_TOKEN` | Client token for SQL smoke            |
| `PLUG_E2E_BASE_URL`     | Hub base URL (e.g. staging `/api/v1`) |

Optional repository variable: `PLUG_E2E_TIMEOUT_MS` (defaults to `30000` in CI).

Owner governance smoke (`tests/e2e/user-access.e2e.test.ts`) uses optional owner credentials:

| Variable                  | Purpose                                   |
| ------------------------- | ----------------------------------------- |
| `PLUG_E2E_OWNER_USER`     | Owner login email for `/me/clients` smoke |
| `PLUG_E2E_OWNER_PASSWORD` | Owner login password                      |

When unset, the owner E2E test is skipped. `PLUG_E2E_BASE_URL` is shared with other live suites.

The job runs `npm run test:e2e:ci` and is marked `continue-on-error: true` so missing secrets do not block merges. For full hub coverage against staging, run `npm run test:e2e:hub` locally or extend the workflow once `PLUG_E2E_DENIED_RESOURCE` and optional cancel/bulk env vars are configured in secrets.

## Scope

- Auth: login, refresh, invalid refresh, session-runner retry
- REST and Socket SQL (`agents:command`, node typeVersion 2)
- Aggregated JSON smoke and empty-result output
- Raw JSON-RPC negative probes (authorization, invalid SQL, multi_result)
- `sql.executeBatch` via **Execute Batch** (`PLUG_E2E_BATCH_COMMANDS_JSON`)
- Hub SQL options smoke (`PLUG_E2E_SQL_HUB_OPTIONS_QUERY`: preserve, pagination, streaming)
- Optional `sql.bulkInsert` when `PLUG_E2E_BULK_INSERT_JSON` is set
- Optional `sql.cancel` when `PLUG_E2E_CANCEL_EXECUTION_ID` or `PLUG_E2E_CANCEL_REQUEST_ID` is set
- Mocked custom socket publish/wait (`custom-socket-events.e2e.test.ts`)
- Optional bounded hub stress probe (`stress.e2e.test.ts`, off unless `PLUG_E2E_STRESS_ENABLED=1`)
- Optional DDL/DML transaction lifecycle (`sql-ddl-dml-transaction.e2e.test.ts`, off unless `PLUG_E2E_DDL_ENABLED=1`)

## Smoke query variables

Positive queries (defaults use ERP tables **Cliente**, **Vendedor**, **Produto**):

| Variable                      | Default                         |
| ----------------------------- | ------------------------------- |
| `PLUG_E2E_SQL_QUERY_CLIENTE`  | `SELECT TOP 10 * FROM Cliente`  |
| `PLUG_E2E_SQL_QUERY_VENDEDOR` | `SELECT TOP 10 * FROM Vendedor` |
| `PLUG_E2E_SQL_QUERY_PRODUTO`  | `SELECT TOP 10 * FROM Produto`  |

Legacy overrides (used when set instead of Vendedor/Produto):

- `PLUG_E2E_SQL_QUERY_MARCA`
- `PLUG_E2E_SQL_QUERY_GRUPO_PRODUTO`

## Negative and multi-result probes

| Variable                                  | Purpose                                                                                 |
| ----------------------------------------- | --------------------------------------------------------------------------------------- |
| `PLUG_E2E_DENIED_RESOURCE`                | Table name the client token **must not** read (required for authorization E2E)          |
| `PLUG_E2E_SQL_QUERY_UNAUTHORIZED`         | Built from denied resource if unset                                                     |
| `PLUG_E2E_SQL_QUERY_INVALID`              | Default: `SELECT FROM Cliente`                                                          |
| `PLUG_E2E_SQL_QUERY_MULTI_RESULT_SUCCESS` | Default: `SELECT TOP 5 CodCliente FROM Cliente; SELECT TOP 5 CodVendedor FROM Vendedor` |
| `PLUG_E2E_SQL_QUERY_MULTI_RESULT_MIXED`   | Default: narrow Cliente select + denied resource `SELECT *`                             |

### Finding `PLUG_E2E_DENIED_RESOURCE`

1. Run **Get Client Token Policy** in n8n for your test credential, or
2. Try `SELECT TOP 1 * FROM <Table>` for a table you expect to be blocked.

If the unauthorized probe returns **success**, authorization tests **skip** with a clear message (token is too permissive for the default probe).

## Batch vs multi_result

| Mechanism                          | Hub method                             | Env / node                          |
| ---------------------------------- | -------------------------------------- | ----------------------------------- |
| **Multi Result** on one SQL string | `sql.execute` + `options.multi_result` | `PLUG_E2E_SQL_QUERY_MULTI_RESULT_*` |

`multi_result` uses agent streaming (`executeMultiResultQueryStream`). Prefer **narrow column lists** (for example `CodCliente`, `CodVendedor`) instead of `SELECT *` on wide ERP tables; some DateTime columns fail streaming decode with `SELECT *`.
| **Execute Batch** node | `sql.executeBatch` | `PLUG_E2E_BATCH_COMMANDS_JSON` |

Default batch JSON (read-only):

```json
[{ "sql": "SELECT TOP 1 * FROM Cliente" }, { "sql": "SELECT TOP 1 * FROM Vendedor" }]
```

## Hub SQL options smoke

| Variable                         | Default                                             | Purpose                                                                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PLUG_E2E_SQL_HUB_OPTIONS_QUERY` | `SELECT TOP 100 * FROM Cliente ORDER BY CodCliente` | Used for REST **pagination** only when the SQL includes `ORDER BY` on a stable key (`CodCliente`, not `id`); otherwise the suite uses a built-in paginated query. Preserve and streaming smokes use `PLUG_E2E_SQL_QUERY_CLIENTE`. Use `TOP 1` or higher (not `TOP 0`). |

Socket tests in the same suite exercise `prefer_db_streaming` when the agent supports it.

## Optional cancel E2E

Set **one** of:

- `PLUG_E2E_CANCEL_EXECUTION_ID`
- `PLUG_E2E_CANCEL_REQUEST_ID`

When both are empty, cancel tests skip. Use ids from a long-running query you started separately, or skip in CI.

## Optional bulk insert E2E

Set `PLUG_E2E_BULK_INSERT_JSON` to a full `sql.bulkInsert` params object (table, columns, rows, etc.). Use a **safe staging table** only. When unset, bulk insert E2E tests skip.

## Optional DDL/DML lifecycle E2E

Full mutating SQL lifecycle against a unique staging table (`PlugE2E_DdlDml_*`). **Opt-in** — requires a client token that allows `CREATE TABLE`, `INSERT`, `UPDATE`, `DELETE`, and `DROP TABLE`.

| Variable                                | Default  | Purpose                                                                          |
| --------------------------------------- | -------- | -------------------------------------------------------------------------------- |
| `PLUG_E2E_DDL_ENABLED`                  | off      | Set to `1` to run DDL/DML lifecycle tests                                        |
| `PLUG_E2E_DDL_STEP_MAX_MS`              | `30000`  | Per-step client timing limit (ms)                                                |
| `PLUG_E2E_DDL_FLOW_MAX_MS`              | `120000` | Total lifecycle timing limit (ms); auto-extended when stress rows are configured |
| `PLUG_E2E_DDL_STRESS_ROW_COUNT`         | `500`    | Extra rows inserted/updated/deleted for moderate stress                          |
| `PLUG_E2E_DDL_STRESS_INSERT_BATCH_SIZE` | `100`    | Rows per `INSERT` batch during stress phase                                      |
| `PLUG_E2E_DDL_STRESS_STEP_MAX_MS`       | `60000`  | Per-step limit for bulk INSERT/UPDATE/DELETE                                     |

Flow (REST and Socket):

1. `CREATE TABLE` with `Id`, `Name`, `Amount`, `CreatedAt`
2. `INSERT` 3 seed rows, `SELECT` to verify
3. **Stress phase (default 500 rows):** batched `INSERT`, `COUNT(*)` verify, bulk `UPDATE`, sample `SELECT`
4. `UPDATE` one seed row, `SELECT` to verify
5. `executeBatch` with `transaction: true` — failing batch rolls back an insert
6. `executeBatch` with `transaction: true` — successful batch commits an insert
7. `DELETE` all rows, `DROP TABLE` cleanup (also runs in `afterAll` on failure)

Socket runs request **Request Server Timings** when supported; each step asserts client elapsed time and server phase totals when present. Bulk stress steps also log throughput (`rows/s`) and server phase breakdown to the console.

Mutating steps use `sql.executeBatch` (not single `sql.execute`) because the hub rejects materialized DDL/DML responses with `result_too_large`. On Socket, verification `SELECT` statements run in the same batch as the preceding mutation so row reads stay consistent with the agent connection.

```bash
PLUG_E2E_DDL_ENABLED=1 npm run test:e2e -- tests/e2e/sql-ddl-dml-transaction.e2e.test.ts
```

## Optional stress probe

Stress E2E hammers the **real hub** with a bounded pool of concurrent `executeSql` calls. It is **opt-in** and excluded from `npm run verify`.

| Variable                            | Default       | Purpose                                        |
| ----------------------------------- | ------------- | ---------------------------------------------- |
| `PLUG_E2E_STRESS_ENABLED`           | off           | Set to `1` to run stress tests                 |
| `PLUG_E2E_STRESS_CONCURRENCY`       | `4`           | Max in-flight requests (cap 25)                |
| `PLUG_E2E_STRESS_REQUEST_COUNT`     | `12`          | Total requests per channel (cap 60)            |
| `PLUG_E2E_STRESS_MIN_SUCCESS_RATIO` | `0.25`        | Minimum share of success + rate-limit outcomes |
| `PLUG_E2E_STRESS_CHANNELS`          | `rest,socket` | Channels to exercise                           |

The probe uses `PLUG_E2E_SQL_QUERY_EMPTY` with `maxRows: 10` to limit agent load. **Rate limits are expected** under stress and count toward the healthy-response ratio. **Unexpected failures** (non-retryable errors other than rate limit / infra) fail the test.

```bash
PLUG_E2E_STRESS_ENABLED=1 npm run test:e2e:stress
```

## Infrastructure skips

Command tests skip when:

- the agent is offline (`agent_offline`)
- the hub returns transient `503` / “coming online”

See `tests/e2e/helpers/environmentSkips.ts`.

## Hub documentation

Maintainer index: [docs/hub-contract-alignment.md](../../docs/hub-contract-alignment.md). See also [Performance and reliability](../../docs/performance-and-reliability.md).

Run `PLUG_E2E_STRESS_ENABLED=1 npm run test:e2e:stress` periodically to validate rate-limit behavior under bounded load.
