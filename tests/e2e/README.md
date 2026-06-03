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
npm run test:socket
```

`test:e2e:hub` runs only REST and Socket E2E files (batch, hub SQL options, cancel suites are registered there).

E2E is **not** part of `npm run verify`. The suite runs sequentially (`fileParallelism: false`).

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

| Variable                                  | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `PLUG_E2E_DENIED_RESOURCE`                | Table name the client token **must not** read (required for authorization E2E) |
| `PLUG_E2E_SQL_QUERY_UNAUTHORIZED`         | Built from denied resource if unset                                            |
| `PLUG_E2E_SQL_QUERY_INVALID`              | Default: `SELECT FROM Cliente`                                                 |
| `PLUG_E2E_SQL_QUERY_MULTI_RESULT_SUCCESS` | Default: `SELECT TOP 5 * FROM Cliente; SELECT TOP 5 * FROM Vendedor`           |
| `PLUG_E2E_SQL_QUERY_MULTI_RESULT_MIXED`   | Default: success query + denied resource                                       |

### Finding `PLUG_E2E_DENIED_RESOURCE`

1. Run **Get Client Token Policy** in n8n for your test credential, or
2. Try `SELECT TOP 1 * FROM <Table>` for a table you expect to be blocked.

If the unauthorized probe returns **success**, authorization tests **skip** with a clear message (token is too permissive for the default probe).

## Batch vs multi_result

| Mechanism                          | Hub method                             | Env / node                          |
| ---------------------------------- | -------------------------------------- | ----------------------------------- |
| **Multi Result** on one SQL string | `sql.execute` + `options.multi_result` | `PLUG_E2E_SQL_QUERY_MULTI_RESULT_*` |
| **Execute Batch** node             | `sql.executeBatch`                     | `PLUG_E2E_BATCH_COMMANDS_JSON`      |

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
