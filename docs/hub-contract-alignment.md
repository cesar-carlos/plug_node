# Hub contract alignment

This document summarizes how the `n8n-nodes-plug-database` package aligns with the **plug_server** hub contract. The hub remains the normative source; use this file as a maintainer index when the server docs change.

## Canonical server references

When working side-by-side with `plug_server`, read these first:

| Topic                              | Server doc                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| REST bridge and JSON-RPC commands  | `plug_server/docs/api/api_rest_bridge.md`                        |
| Client / User / Agent access rules | `plug_server/docs/api/client_agent_business_rules.md`            |
| Relay `relay:*` on `/consumers`    | `plug_server/docs/socket/socket_relay_protocol.md`               |
| Consumer SDK and channel choice    | `plug_server/docs/socket/socket_client_sdk.md`                   |
| Rate limits and quotas             | `plug_server/docs/limits/limites_acesso_e_quotas.md`             |
| Hub ↔ agent sync checklist         | `plug_server/docs/plug_agente/communication_sync_plug_agente.md` |

The Hub documents its OpenAPI endpoints as `GET /docs` and `GET /docs.json`. The REST command bridge is `POST /api/v1/agents/commands`.

## Transport matrix (commands only)

See [communication patterns](./communication-patterns.md) for channel selection and fallback boundaries, and [error and authorization contracts](./error-and-authorization-contracts.md) for empty rows, offline agents, replay guards and rate limits.

The upstream faithful I/O specification and examples are in `plug_server/docs/plug_agente/remote_action_io_specification.md` and `remote_action_io_examples.md` in the same directory.

## Node parity checklist

| Hub capability                         | Node support                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sql.execute`                          | Execute SQL (guided + advanced)                                                                                                                                |
| `sql.executeBatch`                     | Execute Batch                                                                                                                                                  |
| `sql.bulkInsert`                       | Bulk Insert SQL (guided JSON for table/columns/rows)                                                                                                           |
| `sql.cancel`                           | Cancel SQL                                                                                                                                                     |
| Agent Action I/O v1                    | Ten guided operations. See [workflow behavior and negotiation](./communication-alignment.md#workflow-use-and-safety).                                          |
| SQL Extensions                         | Source and schema inspection, durable execute/get/cancel operations and agent health. See [implemented scope](./communication-alignment.md#implemented-scope). |
| `rpc.discover`                         | Discover RPC                                                                                                                                                   |
| `agent.getProfile`                     | Get Agent Profile                                                                                                                                              |
| `client_token.getPolicy`               | Get Client Token Policy                                                                                                                                        |
| `options.prefer_db_streaming`          | Prefer DB Streaming (SQL options) + Auto Performance Hints on Socket                                                                                           |
| `options.execution_mode`               | Managed / Preserve                                                                                                                                             |
| `options.multi_result`                 | Multi Result                                                                                                                                                   |
| `fastPath` (relay)                     | Socket Options → Relay Fast Path (default on when unset); auto-omitted for all `sql.execute` / `sql.executeBatch`                                              |
| `requestServerTimings`                 | Socket Options; hub phases in `__plug.transport.serverTimings`                                                                                                 |
| `meta.agent_phases` (agent sub-phases) | Parsed when hub forwards nested timings; `agentPhases` in metadata                                                                                             |
| `clientRequestIdEcho` (extension)      | **Gap** — hub/agent handshake only; node uses JSON-RPC `id` as today                                                                                           |
| `streamPullWindowSize` adaptive        | Socket Options (`0` = omit explicit window; policy applies agent hint)                                                                                         |
| `max_parallel_read_only_batch_items`   | Batch options + Auto Performance Hints                                                                                                                         |

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

## Performance contracts (hub ↔ node)

| Contract                                                  | Node status                                                                                                                                          | Requires deployment                                                                                                                |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `requestServerTimings` on relay / `agents:command` / REST | **Shipped** — opt-in via Socket Options; timings in `__plug.transport.serverTimings` when Include Plug Metadata is on                                | Hub (shipped)                                                                                                                      |
| Hub `meta.serverTimings.phasesMs`                         | **Shipped** — parsed from relay JSON-RPC `meta`, top-level `agents:command_response.serverTimings`, REST body                                        | Hub (shipped)                                                                                                                      |
| `meta.agent_phases` / hub-merged `agent_*` keys           | **Shipped** — nested `agent_phases` → `serverTimings.agentPhases`; merged `agent_*` hub keys stay in `phasesMs`                                      | Agent (`plug_agente` item 4, proposed) + hub merge when agent ships                                                                |
| Relay `fastPath` + `omitTraceId` on command frames        | **Shipped** — default fast path when unset; omitted for all `sql.execute` / `sql.executeBatch`; per-frame `traceId` omitted on relay hot path        | Hub (shipped)                                                                                                                      |
| `clientRequestIdEcho: "v1"` extension                     | **Documented gap** — negotiated hub ↔ agent at handshake; node already sends stable JSON-RPC `id` as `client_request_id`; no consumer envelope field | Hub + agent ([ADR 0009](https://github.com/cesar-carlos/plug_server/blob/main/docs/adrs/0009-client-request-id-echo.md), proposed) |

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
