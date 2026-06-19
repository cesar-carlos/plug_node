# Hub contract alignment

This document summarizes how the `n8n-nodes-plug-database` package aligns with the **plug_server** hub contract. The hub remains the normative source; use this file as a maintainer index when the server docs change.

## Canonical server references

When working side-by-side with `plug_server`, read these first:

| Topic                              | Server doc                                           |
| ---------------------------------- | ---------------------------------------------------- |
| REST bridge and JSON-RPC commands  | `plug_server/docs/api_rest_bridge.md`                |
| Client / User / Agent access rules | `plug_server/docs/client_agent_business_rules.md`    |
| Relay `relay:*` on `/consumers`    | `plug_server/docs/socket_relay_protocol.md`          |
| Consumer SDK and channel choice    | `plug_server/docs/socket_client_sdk.md`              |
| Rate limits and quotas             | `plug_server/docs/limits/limites_acesso_e_quotas.md` |
| Hub ↔ agent sync checklist         | `plug_server/docs/communication_sync_plug_agente.md` |

OpenAPI on a running hub: `GET /docs` and `GET /docs.json` under `/api/v1`.

## Transport matrix (commands only)

REST is the channel for auth, catalog, and CRUD. Command execution can use:

| Path                             | Node setting                                         | Notes                                                |
| -------------------------------- | ---------------------------------------------------- | ---------------------------------------------------- |
| `POST /api/v1/agents/commands`   | `Channel = REST`                                     | Hub materializes SQL streams into one JSON response  |
| `agents:command` on `/consumers` | `Channel = Socket`, node **typeVersion 2** (default) | Progressive chunks via `agents:command_stream_*`     |
| `relay:*` on `/consumers`        | Socket **typeVersion 1** or fallback                 | Conversation-scoped; `client_request_id` idempotency |

The node prefers `agents:command` for Socket on typeVersion 2. Single-command flows may fall back to relay when the server does not correlate responses.

## Behaviors that affect n8n workflows

### Successful SQL with zero rows

The hub returns `success: true` with `rows: []` and often `row_count: 0`. That is **not** an error.

With **Response Mode = Aggregated JSON**, the node emits **one output item** when `rows` is empty:

- `rowCount: 0`
- `rows: []`
- `__plug.emptyResult: true`

Downstream nodes can branch on `emptyResult` instead of treating “no items” as a stopped execution.

### Agent offline vs not found

| Situation                                                                     | Typical HTTP / envelope                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Agent known in hub memory but no `/agents` socket, correlatable JSON-RPC `id` | HTTP **200**, `error.code: -32000`, `message: agent_offline`, `data.reason: agent_disconnected_at_dispatch` |
| Agent never registered on this worker                                         | HTTP **404**                                                                                                |
| Overload, mid-request disconnect, notification-only while offline             | HTTP **503** or stream failure                                                                              |

The node maps offline reasons to a clear user message (see [Error and Authorization Contracts](./error-and-authorization-contracts.md)).

### Replay guard (`-32014`)

Repeating the same `command.id` (string/number) for the same `agentId` within about **two minutes** returns `error.code: -32014` and `data.reason: replay_detected` without re-dispatching to the agent. Generate a fresh JSON-RPC `id` per intentional retry.

### Rate limits

- HTTP **429** with `TOO_MANY_REQUESTS` on auth and command routes
- Agent-side **-32013** (for example `client_token.getPolicy`) with `retry_after_ms` / `reset_at`; hub may set `Retry-After`

Cache login tokens in long-running workflows (see server limits doc).

## Node parity checklist

| Hub capability                       | Node support                                                         |
| ------------------------------------ | -------------------------------------------------------------------- |
| `sql.execute`                        | Execute SQL (guided + advanced)                                      |
| `sql.executeBatch`                   | Execute Batch                                                        |
| `sql.bulkInsert`                     | Bulk Insert SQL (guided JSON for table/columns/rows)                 |
| `sql.cancel`                         | Cancel SQL                                                           |
| `rpc.discover`                       | Discover RPC                                                         |
| `agent.getProfile`                   | Get Agent Profile                                                    |
| `client_token.getPolicy`             | Get Client Token Policy                                              |
| `options.prefer_db_streaming`        | Prefer DB Streaming (SQL options) + Auto Performance Hints on Socket |
| `options.execution_mode`             | Managed / Preserve                                                   |
| `options.multi_result`               | Multi Result                                                         |
| `fastPath` (relay)                   | Socket Options → Relay Fast Path                                     |
| `requestServerTimings`               | Socket Options                                                       |
| `streamPullWindowSize` adaptive      | Socket Options (`0` = agent recommendation)                          |
| `max_parallel_read_only_batch_items` | Batch options + Auto Performance Hints                               |

## Test coverage matrix (plug_node)

| Hub method / option                                                   | Unit (mock)                                              | E2E live                      | Notes                                                                                                       |
| --------------------------------------------------------------------- | -------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `sql.execute`                                                         | `plugSqlGuidedCommands.test.ts`, `nodeExecution.test.ts` | `sqlLiveSuite` REST + Socket  | Smokes, empty rows, invalid SQL, auth probes                                                                |
| `sql.execute` + `multi_result`                                        | `plugSqlGuidedCommands.test.ts`                          | `sqlLiveSuite`                | Semicolon SQL; not the same as `executeBatch`                                                               |
| `sql.execute` + `execution_mode` / pagination / `prefer_db_streaming` | `plugSqlGuidedCommands.test.ts`                          | `sqlHubOptionsLiveSuite`      | Pagination needs stable `ORDER BY` (e.g. `CodCliente`); use `TOP 1+`, not `TOP 0`; skips when agent rejects |
| `sql.executeBatch`                                                    | `plugSqlGuidedCommands.test.ts`, `nodeExecution.test.ts` | `sqlBatchLiveSuite`           | `PLUG_E2E_BATCH_COMMANDS_JSON`                                                                              |
| `sql.bulkInsert`                                                      | `plugSqlGuidedCommands.test.ts`                          | `sqlLiveSuite` (gated)        | Requires `PLUG_E2E_BULK_INSERT_JSON`                                                                        |
| `sql.cancel`                                                          | `plugSqlGuidedCommands.test.ts`, `nodeExecution.test.ts` | `sqlCancelLiveSuite` (gated)  | Requires cancel ids in `.env`                                                                               |
| Stress probe                                                          | `stressOutcomes.test.ts`                                 | `stress.e2e.test.ts` (opt-in) | `PLUG_E2E_STRESS_ENABLED=1`                                                                                 |
| Transient retry (429/503/timeout)                                     | `plugTransientRetry.test.ts`, `nodeExecution.test.ts`    | —                             | Up to 3 attempts; no retry on `replay_detected`                                                             |
| Execute Batch coalesce (opt-in)                                       | `plugBatchCoalesce.test.ts`                              | —                             | `coalesceInputItems` in batch Additional Options                                                            |

Shared SQL command builders live in [`shared/n8n/plugSqlGuidedCommands.ts`](../shared/n8n/plugSqlGuidedCommands.ts); orchestration stays in [`plugClientExecution.ts`](../shared/n8n/plugClientExecution.ts).

## E2E smoke tables

Live tests in `tests/e2e/` default to ERP tables that exist in typical deployments:

- `Cliente`
- `Vendedor`
- `Produto`

Negative authorization probes require `PLUG_E2E_DENIED_RESOURCE` in `.env` — a table name the test **client token must not** read. See [tests/e2e/README.md](../tests/e2e/README.md).

## When the server contract changes

1. Update `plug_server` normative docs and OpenAPI.
2. Update this file and [Error and Authorization Contracts](./error-and-authorization-contracts.md).
3. Adjust shared validators / execution in `shared/` and add regression tests (unit + E2E when transport is affected).
4. Add a Changeset for any published package behavior change.
