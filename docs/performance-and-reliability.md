# Performance and Reliability

## Dependency refresh — 2026-10-30

Stable npm registry metadata was checked for every direct dependency. Updated versions include CLI 0.54.6, ESLint 10.14.0, n8n-workflow 2.45.4 (`stable`; its `latest` tag still points to 2.16.0), Vitest/coverage 5.0.5, dependency-cruiser 18.7.0, dotenv 18.0.9, Playwright/Chromium 1.64.1, jose 6.2.14, marked 18.1.2, to-words 7.4.1, Zod 4 alias 4.6.7, Prettier 3.9.10, release-it 21.1.2, Node 24 types 24.19.2, and npm 12.2.1. Libraries already at their newest stable version retain their pins.

Compatibility constraints remain explicit: Node 24 types track the runtime rather than Node 26; TypeScript 7 compiles while the TypeScript 6 alias supplies the JavaScript compiler API; Zod 3.25.76 remains the exact peer required by n8n-workflow 2.45.4. The CLI's nested ESLint 9.29.0 follows its own upstream pin, while project lint runs ESLint 10.14.0.

The same-major `qs@>=6.0.0 <6.17.1` override selects 6.17.1 to fix malformed comma-array serialization and related parser advisories; a regression test covers the non-callable `toString` case. Remove this override once the n8n backend-network dependency requires a corrected version. Do not force incompatible major versions into upstream SDKs solely to clear audit output.

The final dependency audit reports 28 findings (0 critical, 23 high, 4 moderate, 1 low), down from 32 including 2 critical. Production-only audit still reports one high finding in the Zod 3 host peer ([advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)); the application JSON-RPC schemas use patched Zod 4.6.7. Other root advisory chains are development/host tooling dependencies (`basic-ftp`, `deepmerge`, `stream-json`, and `uuid`); their current parents do not select patched compatible releases, or no patch exists on the required line. This is not a zero-vulnerability result. Reassess when upstream publishes compatible fixes.

## npm distribution size

The npm `files` allowlist publishes JavaScript, TypeScript declarations, JSON, SVG assets, and the package README. Development `.js.map` files remain available in local builds but are excluded from npm because the referenced TypeScript sources are not shipped. Published runtime code is unchanged; production stack traces use compiled JavaScript locations unless maps and source files from the matching revision are supplied separately.

Measured on 2026-10-30 with npm 12.2.0, excluding 167 source maps reduced the tarball from 353,339 to 221,772 bytes (37.2%) and unpacked contents from 2,080,966 to 1,380,975 bytes (33.6%). The existing 360,000-byte compressed and 2,200,000-byte unpacked limits remain unchanged. Dependencies installed by npm, including Chromium and image/PDF libraries, are unaffected by this tarball reduction.

`npm run pack:check` compares the built file inventory against the tarball and rejects missing runtime files, types, or assets, stale files, and reintroduced `.js.map` files. When adding another asset format, update the npm allowlist so this check continues to pass. Do not disable source maps in `tsconfig.json` or strip runtime exports to meet the size budget.

## Runtime dependency footprint

`npm run bench:footprint` measures isolated imports, RSS deltas, and installed package sizes. On Windows / Node 24.18.0 (2026-10-30), one local run measured approximately 35 MB for pdfjs-dist, 19.5 MB for pdf-lib, and 13.5 MB for playwright-core. Import times were approximately 23 ms, 395 ms, and 315 ms respectively; these single-run observations are not regression thresholds. Sizes exclude hoisted transitive dependencies and browser downloads.

Playwright is already imported on demand in the PDF renderer. Keep that boundary. The local browser executable was unavailable, so this run does not establish PDF rendering or browser installation performance. Use the native packaged-install profile to validate the browser runtime before release.

## TypeScript 7 and dependency migration

Compilation, typecheck and watch use TypeScript `7.0.2`. Analysis tools retain the `6.0.2` compiler API through a tested npm alias; CommonJS package loading, ES2019 output target and strict compiler flags are preserved with NodeNext resolution. The API bridge can be removed when the analysis toolchain supports the native compiler's stable API.

Dependency migration measurements use a separate source, dependency and compiled snapshot under `tmp/dependency-migration-baseline`, including the transport reliability fixes already present before migration. Do not reuse the earlier, incorrect transport baseline to approve this update. `PLUG_BENCH_TRANSPORT_BASE` selects this snapshot; `PLUG_BENCH_REPORT_PATH` keeps comparison reports separate from earlier reports.

`npm run bench:typescript` compares cold typecheck, full compiler emission and incremental builds in nine alternating isolated process pairs. Initial incremental emission is outside the measured interval; reports include median duration and process peak RSS. npm/n8n CLI overhead is excluded. Compilation gains do not imply faster SQL or network operations.

The default compiler baseline is `tmp/dependency-migration-baseline/reconstructed`: the original source snapshot with a clean installation from its original lockfile. Copying only root `node_modules` misses dependencies installed inside the package. The reconstruction preserves the original lockfile hash and passes TypeScript `5.9.3` typecheck before measurement. `PLUG_BENCH_TYPESCRIPT_BASE` selects another complete baseline installation.

On the local Windows machine, nine isolated comparisons produced these medians:

| Compiler operation  | TypeScript 5.9.3 | TypeScript 7.0.2 | Speedup | Peak RSS reduction |
| ------------------- | ---------------: | ---------------: | ------: | -----------------: |
| Cold typecheck      |       3,675.9 ms |         425.2 ms |    8.6× |              31.9% |
| Full compiler build |       4,553.7 ms |         612.7 ms |    7.4× |              32.3% |
| Incremental build   |       2,486.3 ms |         271.6 ms |    9.2× |              36.3% |

Both compilers also emitted the same 499 artifact paths without diagnostics and loaded all 11 published classes with equal metadata. These measurements include dependency/configuration migration; they do not isolate the compiler alone from those changes.

`npm run bench:dependencies` executes the existing PayloadFrame and gzip workers for nine alternating baseline/candidate pairs. PayloadFrame reports averages descriptively and retains its separate existing baseline gate; gzip level 3 checks p95, throughput, peak heap and compressed bytes against the migration baseline. Its level 6 comparison also preserves the earlier level-selection criteria. Socket fixtures are encoded in a separate process so each measured client imports only its own codec graph. The initial asymmetric Socket report, including its failed stream-8 heap gate, is retained as `socket-comparison-initial.json`; it is not an approved result.

The corrected Socket comparison passed all six scenarios: maximum p95 ratio `1.049`, minimum throughput ratio `0.992`, maximum heap-growth ratio `1.008`. All five gzip scenarios passed, with maximum p95 ratio `1.043`, minimum throughput ratio `0.984`, unchanged compressed bytes and no heap-growth regression. Gzip level 3 also retained its level 6 selection gates; comparable compressed SQL frames grew by about `1.03%`. The existing PayloadFrame gate passed with its unchanged `15%` baseline threshold. These are local synthetic measurements, not live Plug service throughput or loss guarantees. Full Linux approval remains blocked by the Docker watch behavior documented in the testing strategy.

Repeat the existing PayloadFrame gate, gzip comparison and signed Socket scenarios at concurrency 1, 4 and 8. For this migration's correct baseline, every Socket scenario must pass p95 ≤105%, throughput ≥85% and peak heap growth ≤110%, with no missing/duplicated rows, unhandled rejections or residual listeners. Reports are stored under `tmp/e2e-logs/dependency-migration/`. Baselines and gates are not recalibrated.

PDF.js 6 cleanup belongs to the loading task, which is destroyed in `finally` after success or failure. Number-to-words now uses native dynamic import rather than an evaluated function, preserving locale output and working with both NodeNext emission and the Vitest runtime.

Guidance for running the Plug Database n8n node efficiently and safely against the Plug hub and ERP SQL Server schemas.

## Channel and response mode

| Scenario                               | Recommendation                                                                                        |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Small reads, CRUD, smoke tests         | **REST** + **Aggregated JSON** (per-row) or **Aggregated Single Item** (one item with `rows[]`)       |
| Large `SELECT`                         | **Socket** (node typeVersion **2**) + **Prefer DB Streaming** + **Chunk Items** when needed           |
| Several independent statements         | **Execute Batch** (`sql.executeBatch`)                                                                |
| Several result sets in one SQL text    | **Execute SQL** + **Multi Result** (not batch)                                                        |
| Large lists without loading everything | Pagination (`page` + `pageSize`) with stable **`ORDER BY`** (for example `CodCliente`, `CodVendedor`) |

Socket typeVersion 2 reuses the consumer transport for all items in one node execution. Relay fallback reuses the relay transport the same way (**conversation reuse across successful commands** for the same `agentId`; the conversation ends on failure even when reuse is enabled; the socket stays connected when healthy).

## SQL conventions (ERP)

- Use **`TOP 1` or higher** â€” SQL Server does not accept `TOP 0`.
- **Cliente** primary key: `CodCliente` (not `id`).
- **Vendedor** primary key: `CodVendedor`.
- Paginated queries must include an explicit **`ORDER BY`** on a stable key.

## Socket buffering

Defaults (per item): 512 chunks, 50,000 rows, 8 MiB. Tune under **Socket Options** when streaming large reports. All response modes, including **Chunk Items**, retain results until the node returns. Chunk Items preserves chunks for output; it does not provide incremental n8n output or constant memory. Use pagination for datasets exceeding the per-item limits.

`streamPullWindowSize` (0â€“1000) controls how many chunks are requested per pull window. Use **0** (default) for adaptive mode: the node omits an explicit window and lets the transport apply the agent `recommendedStreamPullWindowSize`, clamped to hub/agent max (fallback **256** when no hint is present). Set an explicit value (for example **512**) to override the agent recommendation up to the hub ceiling.

## Large result shaping (n8n output)

**Aggregated JSON** (default) emits **one n8n item per SQL row** when `result.rows` is present â€” large `SELECT`s can dominate CPU and memory in the workflow even after efficient socket streaming.

**Aggregated Single Item** emits **one n8n item** with `rowCount` and `rows[]` for SQL result sets. Use it when downstream nodes should process the full result set without per-row fan-out (for example a single Code node or HTTP request). Socket streaming still aggregates chunks in memory before output, same as Aggregated JSON.

Choose response shaping to match downstream processing. Socket transport validates each incoming frame once per connection, with up to eight overlapping decodes and ordered application:

- Use **Socket** + **Prefer DB Streaming** + **Chunk Items** to preserve chunk boundaries, while respecting the same accumulated-result limits, or
- Use **Aggregated Single Item** when the full result fits in memory but you want one workflow item, or
- Keep **Auto Performance Hints** on so `aggregatedJson` results with more than 1000 rows are promoted to a single item, or
- Use pagination (`page` / `pageSize`) with a stable `ORDER BY`.

## Relay Fast Path

**Relay Fast Path** is **on by default** for socket relay (all typeVersions) when Socket Options leave it unset. It skips `relay:rpc.accepted` on the happy path and routes responses by JSON-RPC body `id`. Disable only when the hub requires classic accepted correlation. See `plug_server/docs/studies/relay_fastpath_study.md` for hub-side trade-offs.

The node **automatically omits** `fastPath` for **all** `sql.execute` and `sql.executeBatch` commands (including when Prefer DB Streaming / Multi Result are off). Agents may open streams on large or wide results; stream pull needs the hub `requestId` from `relay:rpc.accepted`. Non-SQL unary methods still use fast path by default.

Relay command frames omit per-frame `traceId` on the hot path (aligned with hub high-throughput guidance); stream pulls already did this.

**Request Server Timings** (`requestServerTimings: true` in Socket Options) asks the hub to include server-side phase timings in relay responses when supported. With **Include Plug Metadata**, timings appear under `__plug.transport.serverTimings`:

- `phasesMs` â€” hub bridge phases (`consumer_frame_decode_ms`, `agent_to_hub_ms`, `relay_forward_to_consumer_ms`, â€¦).
- `agentPhases.phasesMs` â€” agent sub-phases when the hub forwards `meta.agent_phases` (snake*case on the wire). When the hub merges agent timings into `phasesMs` with an `agent*`prefix, those keys appear in`phasesMs` directly.

Enable Socket Options â†’ **Request Server Timings** on relay or typeVersion 2 socket runs. Agent-side per-phase breakdown (`plug_agente` roadmap item 4) is optional and not required for hub timings to appear.

## Relay client request id (fast path)

On relay, the JSON-RPC command `id` is the hub `client_request_id` used for idempotency and fast-path response routing (`body.id` echo). The node sets this from each command's JSON-RPC `id` (fresh per retry).

**`clientRequestIdEcho: "v1"`** is a proposed hub â†” agent handshake extension ([`plug_server` ADR 0009](https://github.com/cesar-carlos/plug_server/blob/main/docs/adrs/0009-client-request-id-echo.md)) that would let the agent preserve `body.id` end-to-end without hub rewrite. Consumers do not send this flag; no node change is required until hub and agent negotiate the extension.

## Auto Performance Hints

**Auto Performance Hints** (default **on** in Execute SQL and Execute Batch **Additional Options**) applies performance suggestions only when you have not set the related option explicitly:

| Operation     | When hints apply (Socket / batch)                        | Suggestion                                   |
| ------------- | -------------------------------------------------------- | -------------------------------------------- |
| Execute SQL   | Channel = **Socket**, `SELECT TOP N` with **N â‰¥ 1000** | `options.prefer_db_streaming: true`          |
| Execute Batch | All commands are read-only `SELECT`                      | `options.max_parallel_read_only_batch_items` |

Hints do **not** override explicit **Prefer DB Streaming**, **Max Parallel Read-Only Items**, or **Auto Performance Hints = off**.

## Bulk Insert limits

Bulk Insert is validated client-side before dispatch: at most **50,000** rows and ~**10 MiB** of serialized `table`/`columns`/`rows` JSON (hub `AGENT_SQL_BULK_INSERT_MAX_ROWS` / `AGENT_SQL_BULK_INSERT_MAX_JSON_BYTES`). Split larger loads into multiple node runs or batches manually; the node does not auto-chunk.

## Timeouts and cancellation

The shared timeout policy applies to REST, consumer commands, relay and relay batch:

- The default hub wait is **30,000 ms** when no timeout is provided; the client sends this explicitly.
- For `sql.execute`, `sql.executeBatch` and `sql.bulkInsert`, hub wait is the greater of the requested bridge timeout and agent `options.timeout_ms + 5,000 ms`, capped at **360,000 ms**. JSON-RPC arrays use the largest SQL timeout. The agent timeout is preserved.
- HTTP and initial Socket waits add **5,000 ms** to the effective hub wait. For example, an agent SQL timeout of 15 seconds gives a hub wait of 20 seconds and a transport wait of 25 seconds.
- Socket connection waits are capped at **10,000 ms**.
- Active streams use a correlated **inactivity timeout**, renewed by their own responses, chunks, completion and pull acknowledgements. Outgoing pulls and unrelated commands do not extend it. Active streams have no absolute lifetime deadline.
- Completion, failure, cancellation, disconnect and execution close remove operation listeners, timers and pending reservations. Late decodes cannot apply results to a completed operation. Pulls for the same conversation, request and stream cannot overlap.

The short capability probe has its own cancellable 1.5-second budget; it does not dispatch the SQL command and cannot extend the actual command's timeout.

## Connection dispatch and memory

The managed connection owns one dispatcher independent of Socket.IO. Commands register before dispatch. Responses route by client request ID, hub request ID, conversation and stream; accepted and initial responses establish hub aliases. Unassignable protocol failures terminate affected pending operations, and mutable response data belongs to one operation.

Incoming PayloadFrames reserve their declared decoded size before decode; legacy JSON is measured once. Queued frames, running decodes and results waiting for application count against pending capacity. Accumulated results and reservations share each item's byte/chunk budget; relay batch items have independent budgets. The connection budget is the sum of registered item budgets plus **64 KiB** for control traffic. Exceeding capacity fails with `SOCKET_BUFFER_LIMIT`; chunks are never silently dropped. Pulls stop when receive capacity is exhausted.

Signing policy is fixed per connection context. Changes require a new context, and validated data cannot cross signing configurations. Optional internal metrics include `decodes`, `peakPendingFrames` and `peakPendingBytes`, without payloads or secrets. `serverTimings` accepts valid unknown phase names under schema version 1 and ignores unsupported schema versions.

The hub capability probe is single-flight and cached for **60 seconds** per connection. Agent recommendations and stream ceilings use a separate **60-second cache keyed by agentId**. Identified discovery/profile responses populate it; no mandatory discovery is added for every agent. Unknown agents use fallback 256, without borrowing another agent's hints. Connection recreation, identity change and execution close invalidate cached state.

## Transient retries

The node supports up to three attempts (initial plus two retries) for eligible transient failures. Metadata operations retain their existing retry policy. SQL operations are retried only when the failure establishes that redispatch is safe.

SQL timeouts on REST or Socket, missing/ambiguous HTTP responses, HTTP 5xx, disconnected transports and rejected pulls after dispatch are not automatically retried. They may indicate an already-running command. Relay fallback is allowed only before actual command dispatch, when the capability probe establishes that consumer commands are unsupported. No fallback is permitted after dispatch.

Validation, auth failures, `replay_detected` and `method_not_found` are not transient retries. Eligible explicit rate-limit rejections still follow the existing policy. Retries receive fresh JSON-RPC IDs; use an Idempotency Key when intentionally retrying at workflow level. Failed or aborted streams reject partial results in every output mode.

With **Include Plug Metadata**, `__plug.transport` can include `attemptCount`, `lastRetryDelayMs`, `connectedAfterMs` and supported timing metrics.

## Codec and local measurement

Gzip output is bounded during decompression by the smallest of declared decoded size, **10 MiB**, and compressed bytes multiplied by the maximum inflation ratio (**10**). Actual size, signature and JSON checks still apply. Compression modes `none`, `default` and `always` preserve the fallback to uncompressed frames when inflation would exceed that ratio.

Run the existing PayloadFrame benchmark and its unchanged baseline gate. `scripts/benchmark-socket-concurrency.mjs` compares a saved built base (`PLUG_BENCH_TRANSPORT_BASE`, default `tmp/transport-baseline/dist`) with the built candidate in nine alternating isolated process pairs, using signed unary/stream scenarios at concurrency 1, 4 and 8. Gates are p95 ≤105%, throughput ≥85% and peak heap growth ≤110%; previously incorrect scenarios use correctness and memory criteria. The script records legacy unhandled rejections explicitly and rejects any candidate rejection, missing/duplicated rows or residual listeners. Its transport is simulated, not live homologation.

`scripts/benchmark-gzip-levels.mjs` compares gzip levels 6 (previous default), 1 and 3 with identical repetitive SQL, SQL rows, low-compressibility data, signatures and near-limit payloads. Nine isolated repetitions approved **level 3**, with at most 1.1% additional compressed bytes and passing latency, throughput and memory gates in every comparable case. Sync and async encoding now use level 3; the compression modes and inflation fallback remain compatible. Reports and verification logs live under `tmp/e2e-logs/`; do not recalibrate the existing baseline to conceal regressions.

The local signed Socket comparison on Node 24.18.0 passed all six scenarios in nine isolated pairs. Against the saved base, streams at concurrency 4 and 8 delivered approximately **80% and 126% higher throughput**, with **30% and 32% less peak heap growth**. The base produced unhandled decode-cancellation rejections in these two scenarios, so their acceptance uses correctness and memory rather than treating the base as a correct performance reference. The candidate produced no unhandled rejections, missing/duplicated rows or residual operation listeners. Correct base scenarios also passed p95, throughput and heap gates; peak heap growth at concurrency 1 increased approximately 6% for unary responses and 5% for streams, within the 10% ceiling. These are simulated local measurements and do not establish live-server performance.

Review the implementation in three groups: timeout policy and pull cancellation; queue reservations, connection dispatcher and agent cache; bounded codec and measured performance. Existing reliability fixes have a patch Changeset; additional timeout, buffering and dispatch behavior has a minor Changeset. No automatic publication occurs.

## Idempotency and mutations

- Set **Idempotency Key** on SQL, batch, and bulk insert when workflows can retry.
- Keep **Require WHERE for UPDATE/DELETE** enabled unless a global mutation is intentional.
- Use business keys in `WHERE` clauses (`CodCliente`, not generic `id`).

## Coalesce Input Items (Execute Batch)

Enable **Coalesce Input Items** under batch **Additional Options** to merge `Batch Commands JSON` from every input item into **one** `sql.executeBatch` hub call.

- **Additional Options** must be identical on all items (compared to item 0).
- Maximum **32** commands after merge (same cap as a single relay/hub batch).
- The node returns **one** output item; `__plug.coalescedItemCount` records how many input items were merged.
- Failures apply to the whole batch (not per-item `continueOnFail` granularity).
- **Max Parallel Read-Only Items** and **Auto Performance Hints** control `max_parallel_read_only_batch_items` for read-only batches (see Auto Performance Hints above).

## Hub alignment

See [Hub contract alignment](./hub-contract-alignment.md) and [Workflow examples](./workflow-examples.md).

## Action I/O block validation

Action I/O validates canonical base64 directly on the encoded string, including zero padding bits and the decoded 64 KiB block limit. A local Node 24 benchmark used a 64 KiB block filled with 0xff and a readIo page containing four such blocks. Over five measured batches after one warm-up, the median for 800 block validations fell from 178.4 ms to 33.7 ms. For 120 full page validations it fell from 191.0 ms to 121.6 ms. These measurements cover in-process validation and exclude network and agent execution time.

The Action I/O response validator also avoids serializing an ordinary wire result separately once the enclosing JSON response meets the 512 KiB UTF-8 budget. With the same four-block workload and the base64 optimization already applied, the median for 120 page validations fell from 123.2 ms to 98.6 ms. Standalone result validation still measures its own size.

## REST and Socket buffer copies

With a single response chunk, the Action I/O REST adapter decodes the bounded byte view directly. Multiple chunks are joined using the byte count already checked by the reader. Socket frame signing and verification feed the UTF-8 metadata plus the NUL separator and the binary payload into HMAC in two updates.

A local Node 24 benchmark used a 512 KiB ASCII field, 100 operations per batch and the median of seven batches after warm-up. REST response parsing with an in-memory Fetch stream fell from 64.7 to 54.7 ms. Encoding and decoding uncompressed signed Socket frames fell from 221.4 to 182.6 ms. Both measurements exclude network latency.

Action I/O command dispatch reuses the client's size-checked JSON for the built-in REST body and relay frame. The direct Socket transport reuses its byte count and hands the original object to Socket.IO. The snapshot is scoped to the synchronous invocation of the selected transport. Independent calls and adapters forwarding a modified command serialize what they actually receive.

With 250 sendInput calls carrying a 64 KiB binary block each, three local Node 24 process pairs compared duplicate serialization with reuse. Each process reported the median of seven measured batches after warm-up. The medians across processes were 65.4 to 54.6 ms for REST, 79.0 to 58.2 ms for direct Socket, and 110.4 to 67.3 ms for relay. The fixtures serialize or parse the outgoing payload and return a receipt in memory. Individual runs varied and these times exclude network latency.

SQL Extensions reuse the serialized parameters checked against the inclusive 2 MiB SQL budget. The Socket and relay request budgets count the entire JSON-RPC command, including the ID and method. A local Node 24 benchmark dispatched 100 sql.operation.execute calls per batch with four 63,000-byte string parameters. Across three process pairs (seven measured batches per process after warm-up), median times changed from 90.6 to 81.1 ms for REST, 106.4 to 80.2 ms for direct Socket and 118.0 to 105.4 ms for relay. These in-memory measurements include validation and receipt processing and exclude network and database execution.

SQL stream output aggregates initial rows and subsequent chunks into one fresh row array. In a local benchmark, 200 calls to buildNodeOutputItems in aggregatedSingleItem mode with one initial row and 100 chunks of 250 rows took 73.7 ms instead of 390.5 ms for direct Socket and 73.6 ms instead of 339.8 ms for relay (median of seven batches after warm-up). Both modes use the same aggregation code. The benchmark covers output construction after transport completion and excludes network, decoding and SQL execution.

For signed SQL chunks, the dispatcher reuses the signing context only after verifying the policy and previous keys are frozen. Cache hits now skip repeated immutability checks. Each incoming frame is still independently authenticated before ordered delivery. A local Node 24 benchmark measured 100,000 remember/lookup/forget cycles on distinct delivery objects, taking the median of seven batches after warm-up in each of three process pairs. Median times across processes fell from 53.2 to 46.4 ms without previous keys and from 205.2 to 48.5 ms with eight previous keys. These timings isolate the validation cache and exclude HMAC, decompression, network and database execution.

The Socket and relay decode scheduler advances through newly queued work once, even when completed chunks are waiting behind an earlier delivery. A local Node 24 benchmark used 80 queues per batch, 512 chunks of 16 reserved bytes per queue, and eight concurrent decodes. With delivery held until the last decode started, the median fell from 145.6 to 12.4 ms. With immediate delivery it fell from 16.9 to 14.1 ms. Each of three process pairs measured seven batches after warm-up and verified delivery order and released bytes. These timings isolate scheduling, without network or codec work.

The delivery queue unlinks each delivered or cancelled head directly and clears its link to the remaining tasks. In a local Node 24 benchmark with eight decoder slots, 512 ready chunks per queue and 120 queues per batch, median time from releasing a blocked head through ordered delivery and drain fell from 5.56 to 2.95 ms. Seven batches followed a warm-up in each of three alternating process pairs. Timing excluded enqueue and decode. For the full 80-queue workload described above, times changed from 13.2 to 12.1 ms with blocked delivery and 13.0 to 12.4 ms with immediate delivery.

## Live testing

On Windows, the native Action I/O load fixture runs the built Plug client in a separate Node process against a private authenticated Hub and Flutter agent. Build the package, then run:

```powershell
node scripts/verify-n8n-catalog-workflow.mjs <isolated-agent-checkout> <hub-checkout> <flutter-dart.exe> --load
```

Each round creates a fresh Hub, client and agent. It runs direct Socket first, then REST, starting a Windows PowerShell echo process for each channel. The writer sends 64 distinct 64 KiB blocks and verifies the written receipt for every fourth block before advancing. The reader waits up to 2 seconds per request, accepts at most 64 KiB per page and pauses for 45 ms between pages. After observing both streams it drops the reader, waits 100 ms and opens a new reader with the confirmed sequence and offsets. Socket opens a new WebSocket. REST creates a fresh adapter and abort signal and may reuse an HTTP connection. The writer remains connected throughout.

A slow reader can see `terminal: true` while later pages still contain output. Drain through the `completed` event, checking sequence and byte offsets on each page. Stopping at the first terminal page reproduced a truncated 409,600-byte stream in a 524,288-byte trial. The fixture hashes stdout and stderr incrementally, requires each to match all 4 MiB of input, and checks for exactly two native starts per round. The completion and hash assertions detect missing or repeated bytes.

For a physical REST disconnect, replace `--load` with `--load-rest-reset`. A private loopback proxy resets the reader's TCP socket after writing 32 bytes of a successful Hub response. The writer continues sending to the Hub. In the recorded run, 17 of 64 input blocks had receipts at the cut. The reader retried only the interrupted read on a different TCP connection, starting from sequence 21 and offsets 720,896 (stdout) and 655,360 (stderr). Both streams reached 4 MiB with the input SHA-256, sequence 130 and one native process start. The child PID matched across the cut. [Supplementary TCP reset result](../scripts/benchmarks/native-rest-tcp-reset.json)

Use `--load-socket-reset` to exercise Socket and relay. The proxy resets the reader connection when the Hub replies to an outstanding read while the writer continues on a separate connection. With 16 of 64 input blocks acknowledged, Socket resumed at sequence 21 and relay at sequence 18. Both reached sequence 130 with identical 4 MiB stdout and stderr hashes and one native process start per transport. [Socket and relay TCP reset results](../scripts/benchmarks/native-socket-relay-tcp-reset.json)

The first eight blocks are paced, with an extra delay for process startup. The echo latency measures dispatch through observation of the last stdout byte of each of the seven subsequent paced blocks. Its per-run p95 is the maximum of those seven observations. Send and Read I/O latencies measure complete RPC calls. Throughput counts both output streams and includes startup, intentional pauses, reconnect and final drain. Windows working set is sampled separately for the client, Hub, Flutter tester and PowerShell child at approximately 150 ms intervals. First observation and sampled peak are recorded in bytes for each process. The Hub, agent and client are warm for the second channel. The child first observation is after spawn. [Per-round measurements](../scripts/benchmarks/native-action-io-load.json)

Three complete rounds per variant compared the agent's 100 ms polling loop with local input and output journal commit notifications. The third polling run was a later control using restored original files. The comparison excludes the smaller pilot, a run whose subsequent fixture checks hit the REST quota, and an overlapping signal-patch pilot. Results below are medians of the three per-round statistics. The JSON includes individual rounds, exclusions, hashes and ranges.

| Channel | Variant       | Paced echo p95 (ms) | Read RPC p95 (ms) | Send RPC p95 (ms) | Output (MiB/s) |
| ------- | ------------- | ------------------: | ----------------: | ----------------: | -------------: |
| Socket  | Polling       |                 253 |               160 |               124 |          0.552 |
| Socket  | Notifications |                 137 |               192 |               134 |          0.537 |
| REST    | Polling       |                 335 |               257 |               167 |          0.441 |
| REST    | Notifications |                 253 |               240 |               170 |          0.449 |

The notifications reduced paced echo latency across both channels. Socket Read RPC latency increased in this sample, and output rates varied between runs. Median sampled peak working sets (client / Hub / Flutter agent / child, MiB) were 115 / 193 / 298 / 74 before and 114 / 194 / 297 / 74 after for Socket. For REST they were 124 / 211 / 303 / 74 before and 143 / 212 / 300 / 74 after. This short test does not establish a sustained memory trend.

See [tests/e2e/README.md](../tests/e2e/README.md). Optional stress probe: `PLUG_E2E_STRESS_ENABLED=1 npm run test:e2e:stress`. Dedicated homologation must compare equal 15-minute windows with read-only REST/Socket queries, streams and controlled connection interruptions using `PLUG_E2E_*`. Missing or skipped live tests are not completed homologation. The release smoke suite verifies authentication and read-only connectivity; it does not replace this sustained homologation.
