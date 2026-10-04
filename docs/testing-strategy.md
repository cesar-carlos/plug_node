# Testing Strategy

## Native TypeScript and dependency compatibility

Use Node `24.18.0` and npm `12.2.0`. `npm run verify` includes checks of the actual native compiler and compatibility API resolution, plus a native watch smoke covering initial emission, a type error, repair, file deletion and recreation. It preserves existing lint, typecheck, architectural and package-surface checks.

Vitest and coverage use matching `5.0.3` versions. Fork isolation and serial file execution remain enabled. Schema error fixtures were captured from the pre-migration build and assert the complete public error, including SQL refinements. Zod 4 is imported only through `zod4`; n8n retains its Zod 3 peer. Remove that alias split only after the host supports Zod 4. Keep the local error serializer until an intentional public error-contract change.

Runtime regression cases exercise number-to-words results in English and Brazilian Portuguese, fractions and negatives, CSV Unicode/quotes, asynchronous JSONata, Markdown, JSON Schema formats, and PDF loading cleanup on success and failure. Run the real browser smoke with `PLUG_TEST_REAL_PDF=1`; a default skip does not establish Chromium validation.

`npm run pack:check` checks npm's legacy and npm 12 JSON formats without relaxing tarball size gates, installs two host profiles, and exercises installed native tools in a third profile. This local package validation does not contact Plug services.

Windows validation passed with the native watch smoke. Linux validation in Docker with Node `24.18.0` passed clean installation, compiler/API resolution, typecheck, build, architecture, lint and all three tarball profiles, including native PDF/image operations. Watch did not detect the first edit after initial compilation, on both the Windows bind mount and an ext4 Docker volume. The watch gate remains active; full Linux validation is not approved. This matches the behavior reported in [TypeScript issue 63646](https://github.com/microsoft/TypeScript/issues/63646); the [upstream watcher fix](https://github.com/microsoft/typescript-go/pull/4661) does not justify changing the frozen `7.0.2` inventory automatically. Revalidate the same smoke when adopting an approved compiler release or another supported Linux environment.

## Local quality gates

- `npm run verify` — full gate: prettier, surface checks, doc links, workflow examples, lint, typecheck, all tests, build
- `npm run test:e2e` — live integration tests (skipped without credentials)
- `npm run pack:check` — tarball validation plus smoke install
- `npm run lint` — workspace lint via `n8n-node lint`
- `npm run typecheck` — TypeScript strict check across workspaces

## Test suite size

The migration validation runs **749 root tests and 377 package tests** with `PLUG_TEST_REAL_PDF=1`, for **1,126 passing tests**. Without that flag, the real PDF smoke is skipped; that skip does not establish browser compatibility. Run `npm test` for the full tree.

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
