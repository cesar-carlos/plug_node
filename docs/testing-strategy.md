# Testing Strategy

## Local quality gates

- `npm run verify` — full gate: prettier, surface checks, doc links, workflow examples, lint, typecheck, all tests, build
- `npm run test:e2e` — live integration tests (skipped without credentials)
- `npm run pack:check` — tarball validation plus smoke install
- `npm run lint` — workspace lint via `n8n-node lint`
- `npm run typecheck` — TypeScript strict check across workspaces

## Test suite size

The workspace runs **400+** unit and package tests plus **1 skipped by design** (the live PDF smoke test gated by `PLUG_TEST_REAL_PDF=1`). Run `npm test` for the full tree.

- root tests (`tests/`): unit, integration, contract, and `plugSqlGuidedCommands.test.ts`
- package tests (`packages/n8n-nodes-plug-database/tests/`): node description, execution, and snapshot files

Use `npm test` to run the whole tree or `npm run test:socket` for the focused socket protocol suites (core transport/relay/consumer + trigger reconnect/backpressure, including post-hardening regressions).

## Unit coverage focus

The shared core is exercised in isolation:

- authentication and refresh flows (`tests/public/session.test.ts`)
- REST vs Socket routing and node execution helpers (`tests/public/nodeExecution.test.ts`)
- RPC normalization and ensureSuccessfulNormalizedResponse (`tests/public/rpcNormalization.test.ts`)
- guided SQL command builders (`tests/public/plugSqlGuidedCommands.test.ts`, `shared/n8n/plugSqlGuidedCommands.ts`)
- output shaping (`tests/public/output.test.ts`)
- relay cleanup, conversation validation, and stream handling (`tests/internal/relaySession.test.ts`, `tests/internal/relayErrors.test.ts`, `tests/internal/relayValidationRegressions.test.ts`)
- relay batch accept failures / response-listener cleanup (`tests/internal/relayBatchSession.test.ts`)
- relay batch item with `stream_id` aggregates via stream pull (`tests/internal/relayBatchSession.test.ts`)
- relay manager serialization + JWT recreate (`tests/internal/relaySocketExecutionManager.test.ts`)
- managed transport refcount / deferred dispose (`tests/internal/managedSocketIoTransport.test.ts`)
- parallel chunk decode clear without hang (`tests/internal/parallelChunkDecode.test.ts`)
- relay stream pull session timeout/dispose/terminal listeners (`tests/internal/streamPullSession.test.ts`)
- consumer stream pull helpers + request timeout/ignore (`tests/internal/consumerCommandStreamPull.test.ts`)
- consumer command wire normalizers (`tests/internal/consumerCommandWire.test.ts`)
- consumer command session, stream pull, and fail-fast on payloads without IDs (`tests/internal/consumerCommandSession.test.ts`, `tests/internal/consumerStreamPullRegression.test.ts`)
- PayloadFrame codec including HMAC and inflation guards (`tests/internal/payloadFrameCodec.test.ts`)
- custom socket events end-to-end including REST publish error surfaces (`tests/internal/customSocketEvents.test.ts`, `tests/internal/customSocketEventsRest.test.ts`)
- Socket Event Trigger reconnect mutex, circuit accounting, close mid-connect, and persistent eventId dedupe (`tests/public/socketEventTrigger.test.ts`, `tests/public/triggerReconnectManager.test.ts`)
- trigger backpressure including `maxQueueSize=0/1` overflow policies and emit failures (`tests/internal/triggerBackpressureQueue.test.ts`)
- shared REST validators (`tests/internal/parseHelpers.test.ts`)
- REST list page guard `MAX_COLLECT_PAGES` (`tests/internal/resourceClient.test.ts`)
- workflow migration paths (`tests/public/workflowMigration.test.ts`)

## Integration and contract focus

- Plug protocol fixtures (`tests/internal/socketProtocolContracts.test.ts`, `tests/fixtures/socketProtocolFixtures.ts`)
- shared credential coverage to detect drift between credential files (`tests/public/sharedCredentialCoverage.test.ts`)
- package surface contracts: every published credential, node, and entry point (`tests/public/packageSurface.test.ts`)
- node description snapshots, including option lists and parameter defaults (`tests/public/nodeDescription.test.ts`, `tests/public/plugAccountCredentialSnapshot.test.ts`)

## E2E coverage focus

The `tests/e2e/` suite runs against a real Plug API when `.env` is present. It is **not** part of `npm run verify`.

It covers:

- successful REST and Socket execution (`agents:command` on node typeVersion 2)
- **Aggregated JSON** smoke queries and empty-result output (`rowCount: 0`)
- Socket multi-item parallelism smoke (two input items with `maxParallelInputItems: 2`)
- authorization and SQL validation failures (gated by `PLUG_E2E_DENIED_RESOURCE`)
- `sql.execute` + **multi_result** (semicolon SQL) and **`sql.executeBatch`** (`sqlBatchLiveSuite`)
- hub SQL options: `execution_mode`, pagination, `prefer_db_streaming` (`sqlHubOptionsLiveSuite`)
- login, refresh, and session-runner retry
- optional `sql.bulkInsert` when `PLUG_E2E_BULK_INSERT_JSON` is set
- optional `sql.cancel` when cancel ids are set in `.env`

Custom socket publish + wait is covered by a **mocked** broker test in `custom-socket-events.e2e.test.ts`, not a live hub round-trip.

Optional **bounded stress** probes (`tests/e2e/stress.e2e.test.ts`) run only when `PLUG_E2E_STRESS_ENABLED=1`. They issue concurrent lightweight SQL commands and fail on unexpected hub or transport errors; rate limits count as healthy backpressure.

See [tests/e2e/README.md](../tests/e2e/README.md) and [Hub contract alignment](./hub-contract-alignment.md).

## Infrastructure-aware behavior

Some E2E tests can skip when the agent or hub is temporarily unavailable. This avoids false negatives caused by external infrastructure instability rather than code regressions. See `tests/e2e/helpers/environmentSkips.ts` for the skip rules.

## Regression policy

Every behavior change captured by an audit, bug fix, or contract change must be paired with a regression test. The R1 + R2 + R3 audits that produced 3.0.0 added 23 regression tests across shared validators, page guards, stream pull fail-fast, custom event REST parsing, and relay conversation validation.

Performance-sensitive PayloadFrame changes must also keep `npm run bench:payload-frame:check` green against `scripts/benchmarks/payload-frame-baseline.json` (sync + async decode paths; CI uses a 50% `avgMs` gate with `PLUG_BENCH_ITERATIONS=100`). Calibrate the baseline on **Linux CI** (`ubuntu-latest`, Node 24.18.0), not Windows:

1. Run CI `workflow_dispatch` (job `payload-frame-benchmark` writes artifact `payload-frame-baseline-linux`).
2. Or locally on Linux: `PLUG_BENCH_ITERATIONS=100 npm run sync-shared && npm run build --workspace n8n-nodes-plug-database && node ./scripts/calibrate-payload-frame-baseline.mjs`.
3. Replace `scripts/benchmarks/payload-frame-baseline.json` with the calibrated file and commit only when intentional.

Refresh the baseline only when an intentional, measured improvement lands or when CI runners show systematic platform skew.
