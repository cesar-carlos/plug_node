# Communication alignment

This guide covers Agent Action I/O, SQL Extensions and their acceptance evidence. Start with [communication patterns](./communication-patterns.md) to select a transport and the [Hub contract index](./hub-contract-alignment.md) to locate the upstream protocol.

## Implemented scope

- Add an Agent Action I/O resource with ten operations and separate Hub
  authentication and locally provisioned agent credential roles.
- Use dedicated single-dispatch REST/socket/relay transports, bounded pages and
  caller-owned stable action keys, message IDs, sequences, cursors and offsets.
- Preserve opaque canonical base64, n8n binary input/output and structured
  uncertainty; never reinterpret accepted/written as business success.
- Validate method-specific responses against the shared Hub fixture corpus.
- Add SQL Extensions: `sql.describeSource`, `sql.describeSchema`,
  `sql.operation.execute/get/cancel`, and `agent.getHealth`. Plans retain typed
  scalars, row bounds, prior-output bindings, source and structure expectations.
  Every response is checked against the selected method and request identity.
- Preserve `sql.execute.expectedSource/expectedStructure` in advanced SQL,
  forward credentials in `sql.cancel`, and reject fractional batch concurrency.

The inventory covers all 23 method names in the current OpenRPC 2.11.2 catalog, but does not claim
every optional mode is supported: action execution here selects faithful I/O,
not the legacy text-output mode. REST contract 2.1.0 is additive; I/O remains v1.
The legacy method union is deliberately unchanged: new lifecycle methods cannot
enter the legacy automatic retry pipeline. Existing default API-version behavior
remains compatible; new bridge calls let the Hub select its current version.

## Workflow use and safety

Select **Agent Action I/O** or **SQL Extensions** in Plug Database. The existing
Account credential authenticates the Hub; the additional **Plug Agent API**
credential supplies agent ID and the current locally provisioned token. The
account's legacy client-token default is not used by these resources. A local
token cannot be tested independently of Hub authentication and operation grants;
use **Validate Run** for a read-only check. The credential lint exception is
scoped to this one class and tested; remove it when two-credential testing is
available in n8n.

Persist the action key, message ID and intended sequence before submitting.
**List Available Actions** returns one authorized page per input item, including an empty page. It requires negotiated I/O v1 and `agentActions.catalogVersion: 1`, plus the agent's list, run and I/O grants and action allowlist. Set Page Size to 1–50 (default 20). Leave Cursor empty on the first call, pass `next_cursor` unchanged to the next call with the same agent and client, and stop at `null`. A cursor invalidated by restart or a deleted boundary requires a fresh listing. Capability or authorization errors remain errors. Use Validate Run to check a selected action and trigger before launch.
`run` and `validateRun` share `io.version=1`, `mode=faithful`, initial-input and
close selection. Missing initial input differs from an explicit empty block.
`getExecution` suppresses legacy redacted text; retrieve original bytes with
`readIo`. Its result preserves all events and also exposes each output event as
`binary.event_<sequence>` with stream and byte offset in JSON. No newline,
encoding conversion or placeholder expansion is applied. Stored n8n binary
input is read with a bounded stream and rejected above 64 KiB before dispatch.

Supply committed `after_sequence`, stdout and stderr offsets to Read I/O.
The output includes `next_sequence` and `next_offsets`; commit these only after
consuming the entire page. Offset gaps/overlaps fail closed across pages.
`terminal` and process exit do not establish complete capture: preserve the
completed event, `output_complete`, receipt state and nullable byte progress.

Disable n8n **Retry On Fail** (enforced before login). No auth refresh, ACK,
reconnect, transport fallback or polling loop replays a command. Recovery is an
explicit Find Execution/Get Execution/Get Input Status call with original IDs.
Unknown outcomes require business reconciliation; a new key is a new intent.
SQL cancellation acceptance similarly does not establish rollback.

Each call has a 30-second response budget; readIo waits at most 20 seconds.
SQL's plan timeout (up to 300 seconds) is separate: a response timeout can leave
the durable operation running, so query the original identity. Legacy SQL keeps
its existing timeout. I/O enforces 512 KiB logical JSON/1 MiB wire envelope;
SQL accepts 2 MiB parameter plans (1 MiB per statement), with 3 MiB request and
4 MiB response envelope ceilings. Limits are checked before binary decoding.
The REST transport rejects redirects and caps streaming bytes before parsing;
it uses native fetch because the n8n helper does not expose that pre-buffer cap.
Custom n8n HTTP-helper proxy behavior is not inherited by this bounded adapter.

Socket connections are reused only within one node execution and credential
identity, then disposed. A long read does not lock the transport's write/control
path; separate pending-read limits reserve control capacity. n8n input items are
processed in order to preserve input sequences. Do not put a waiting read before
a dependent input in the same sequential workflow: run reader and controller as
separate workflow branches/executions. No connection or cursor is global.

Static discovery never enables an extension. Every command is admitted or
refused by the Hub's current authenticated agent capability negotiation and the
agent's live authorization. Missing negotiation is surfaced, with no downgrade.
The node neither advertises capabilities on behalf of the agent nor activates
development feature flags. SQL Parameters use contract JSON because translating
typed plans into SQL would change their meaning; credentials cannot be supplied
inside that JSON.

## Acceptance boundaries

`npm run verify` passed 909 root tests and 380 package tests. One pre-existing
optional test was skipped. Coverage reached 85.21% of lines and 75.71% of
branches with the existing thresholds. The archive is 250,866 bytes (69.7% of the
360,000-byte budget) and contains five nodes and seven credentials. Verification
and installation logs are `tmp/e2e-logs/n8n-workflow-verify.log` and
`tmp/e2e-logs/n8n-workflow-pack.log`.
The package installation check loaded the five nodes and seven credentials with n8n-workflow 2.16.0 and 2.45.4. The native profile exercised Sharp, Chromium and PDF extraction. Contract tests import the generated modules shipped in the package.

Importable API is now available after `npm run build` under
`packages/n8n-nodes-plug-database/dist/generated/shared/`:
`contracts/actionIo/client.js` exports `callActionIo(transport, operation, params,
credential)` and `nextActionIoOffsets`; `rest/actionIoTransport.js` exports
`createRestActionIoTransport`; `socket/actionIoTransport.js` exports
`createSocketActionIoTransport` for an authenticated connection. Transports return
logical JSON-RPC envelopes. `socket/actionIoConnection.js` owns optional connection
and relay setup. `contracts/sqlOperation/client.js` exports `callSqlExtension`.

`scripts/verify-native-action-io.mjs <agent-root> <hub-root> <dart-exe>` copies the
agent's isolated controller/reference scenarios to ignored scratch, substitutes
the built node client/transports, and executes the real native fixture. Sibling
checkouts are never edited. The run completed successfully on 2026-10-30:
the **built plug_node client and REST/socket/relay transports** traversed the
authenticated private Hub to a real Windows process. The retained scenario
assertions include exact binary output, input receipts, terminal deduplication,
disconnect/abandoned-read recovery and input progress during a waiting read.
The native matrix was repeated successfully after the final build and contract
corrections; log: `tmp/e2e-logs/alignment-native-final.log` (initial run:
`tmp/e2e-logs/alignment-native.log`). The adapter tests exercise the compiled client. The catalog also has [real n8n workflow coverage](#real-n8n-workflow). The binary helpers/UI metadata have
isolated n8n execution tests. No real database SQL-operation transaction was
executed; SQL evidence is contract and simulated transport testing.

`tests/fixtures/action-io-shared.json` retains all 59 shared cases. Tests compare
parsed corpus content against the sibling Hub when present; set
`REQUIRE_PLUG_SERVER_CONTRACT=1` and `PLUG_SERVER_ROOT` to make that checkout
mandatory. Formatting differences are irrelevant, semantic drift fails.
`bridgeMethodInventory.test.ts` checks the guided action and SQL extension names plus the legacy method union against a pinned inventory. When the sibling sources are present or required, it also compares against the Hub bridge method list and the agent OpenRPC catalog. The catalog native fixture requested one action per page and found both authorized fixture actions over REST, Socket and relay. See `tmp/e2e-logs/catalog-native.log`.
SQL canonical request/result snapshots are checked against `PLUG_AGENT_ROOT`;
`REQUIRE_PLUG_AGENT_CONTRACT=1` makes that checkout mandatory. Focused Ajv/Zod
parity cases cover valid plans and schema boundaries; runtime-only row/binding
and byte-limit checks additionally enforce the agent's documented constraints.

## I/O continuity and queued commands

Each read page starts at the sequence after the requested cursor and advances one event at a time. A missing sequence invalidates the response before the client advances its checkpoint. A socket call waiting for write capacity retains its validated input. If its monotonic deadline expires before emission, it returns SOCKET_TIMEOUT with a known unsent outcome. Timeout after emission still requires reconciliation.

## Unavailable features

For error codes, safe metadata and recovery semantics, see [Unavailable features](./error-and-authorization-contracts.md#unavailable-features). The following results cover the packaged node and native agent fixtures.

### Native availability matrix

The compiled `plug_node` client sent 21 calls through an authenticated loopback Hub.
Each scenario ran over REST, `agents:command` and relay, with one client dispatch per
operation. The Hub companion counted the tested method on outbound agent
`rpc:request` frames separately from registration probes. The current fixture also
checked its native process-start counter before and after all refusals.

| Agent and operation                                                                           | Cases | Result at the node                                                     | Agent dispatches per call |
| --------------------------------------------------------------------------------------------- | ----: | ---------------------------------------------------------------------- | ------------------------: |
| v1.8.6 source, faithful run and SQL cancellation                                              |     6 | `CAPABILITY_UNAVAILABLE`, `not_advertised`                             |                         0 |
| v1.8.6 source, List Available Actions                                                         |     3 | `CAPABILITY_UNAVAILABLE`, `not_advertised` (`agentActions.catalog v1`) |                         0 |
| Current agent with I/O disabled before registration and SQL operations off, same two requests |     6 | `CAPABILITY_UNAVAILABLE`, `not_advertised`                             |                         0 |
| Current agent with I/O disabled after registration, send input                                |     3 | `CAPABILITY_UNAVAILABLE`, `disabled`                                   |                         1 |
| Current native dispatcher with `getExecution` deliberately omitted                            |     3 | `RPC_-32601`, method not executed                                      |                         1 |

The REST preflight returned HTTP 409. All availability refusals reported the agent
as origin and supplied safe reason and recovery details. All four scenarios
reported `retryable:false`, `effects_possible:false`, `outcome_unknown:false`.
When a disabled feature is omitted from the authenticated advertisement, the node
can only report `not_advertised`. The explicit `disabled` reason came from the live
handler before it accessed the journal. The reduced method registry is a separate
fixture for JSON-RPC method-not-found behavior. Generic timeouts retain their
uncertain outcome as covered by the transport tests.

The historical run used `plug_agente` tag `v1.8.6`, commit
`865a3d074e37fe28696d9a65e78e8151e179eb93`, with its native Dart transport,
capability provider and dispatcher. The historical fixture verifies package
version `1.8.6+1` and waits for `agent:ready`. Offline dependency resolution on
the available Flutter SDK adjusted `intl`, `matcher`, `meta`, `test`, `test_api`,
`test_core` and `vector_math`. This establishes compatibility for the compiled tag
source in this environment. An installed historical release binary was outside
the run.

The matrix exposed two integration failures. The node now handles a correlated
`relay:rpc.accepted` refusal immediately, and the Hub confirms `rpc:response`
with one explicit `null` argument as required by the historical Dart ACK callback.
Both agent versions completed registration, the error checks and orderly shutdown
with that Hub fix.

From the workspace root, run `npm run build`, then execute these commands
sequentially on Windows with the matching Hub checkout and dependencies, current
Flutter agent, prepared historical source tree, and the Flutter SDK's `dart.exe`:

```text
node scripts/verify-native-availability.mjs <current-agent-root> <hub-root> <dart.exe>
node scripts/verify-native-availability.mjs <current-agent-root> <hub-root> <dart.exe> --historical-root <v1.8.6-root>
```

The Hub supplies `tool/homologation/agent_1_8_6_availability_test.dart`.
Run Flutter tests sequentially to avoid cache and SQLite contention. The runner
uses disposable identities, a Hub in memory and private temporary manifests.
Safe per-call reports are written under `tmp/native-node-availability/` and
`tmp/native-node-availability-historical/` as `availability-report.json`.
This matrix exercises the packaged client and transports directly. SQL transactions on a live database are outside its scope.

### Real n8n workflow

The [importable catalog workflow](./workflow-examples.md#authorized-action-catalog) ran with `n8n execute` in the official n8n 2.45.7 container using the installed npm tarball. The workflow engine evaluated the second node's cursor expression and resolved Hub and agent credentials from its encrypted credential store. A private TLS proxy forwarded requests for the package's fixed Hub hostname to a local authenticated Hub and native Dart agent. The agent used its token repository and real scope and action allowlist checks.

The n8n execution database recorded `PlugCatalogSmoke` as `success` and `PlugCatalogDeny` as `error`. The first execution verified two distinct one-action pages, an authorized empty page and the non-retryable structured denial on Continue On Fail. The second execution stopped with the Portuguese catalog denial and CLI exit code 1. This workflow run covers REST. Socket and relay have the separate native transport evidence above.

Reproduce on Windows with Docker Desktop, Git OpenSSL (or `PLUG_FIXTURE_OPENSSL`), current Hub and isolated Flutter agent checkouts with their build dependencies, and the Flutter SDK's Dart executable. From the workspace root, build and pack the workspace into `tmp/n8n-catalog-workflow/`. Start a fresh `--rm` container with image `n8nio/n8n@sha256:9a8d8dcea75667496695d7810d7e1fe018a65efb36cc499d347f3931b3957b5d`, a `plug-catalog-n8n-*` name and `--add-host plug-server.se7esistemassinop.com.br:127.0.0.1`. Mount the tarball directory at `/inputs` read-only, publish no ports, and use `--entrypoint sh ... -c 'sleep 1800'`. Install the tarball into `/home/node/.n8n/nodes` with `npm init -y` and `npm install --omit=dev --legacy-peer-deps --no-audit --no-fund /inputs/<tarball>` there. Set `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` for this catalog-only fixture.

```text
node scripts/verify-n8n-catalog-workflow.mjs <isolated-agent-root> <hub-root> <dart.exe> <container-name>
```

The runner expects a fresh disposable container per invocation. Stop it after the test to discard its credential store and temporary TLS key. The safe execution summary is `tmp/n8n-workflow-harness/report.json`. The completed run is logged in `tmp/e2e-logs/n8n-catalog-final.log`.

On 2026-10-31, the same n8n 2.45.7 environment executed the remote action workflow over REST, Socket and relay. Each channel started a separate Windows echo process, sent five bytes with input sequence 0, and read the exact stdout bytes `00 ff 0d 0a 41` before cancelling the process with its input still open. A subsequent Get Execution returned `cancelled` and `flags.terminal = true` for the same execution ID on each channel. To reproduce, append `--actions` to the runner command above. The per-channel results are written to `tmp/n8n-workflow-harness/actions-report.json`.

For response-loss recovery, append `--recovery` in a fresh container. The loopback proxy disconnects the caller after the Hub replies to Run, Send Input and Read I/O on each channel. The workflow finds the running action by its original key, looks up the written receipt by message ID and resumes from the last confirmed sequence and stdout/stderr offsets. Only the read is repeated. All three streams returned `00 ff 0d 0a 41 00 80` exactly once, followed by EOF on stderr and a terminal event. The agent's process factory counted three starts across the three channels. The report is written to `tmp/n8n-workflow-harness/recovery-report.json`. The test keeps the n8n execution alive while its transport disconnects.

For a restart of the n8n service itself, append `--restart` in a fresh disposable container with `N8N_LISTEN_ADDRESS=127.0.0.1`. The test publishes a webhook workflow through the n8n CLI and uses startup activation (`N8N_USE_WORKFLOW_PUBLICATION_SERVICE=false`). For each channel, a webhook Wait node persists the execution after the first output page and the lost input response. The runner reads the sequence and both stream offsets from SQLite, kills the n8n server process group, starts a new server on the same database and calls the workflow's saved `$execution.resumeUrl`. It checks that the same n8n execution completes, the receipt and output belong to the original remote execution, and the agent starts exactly three processes across the three channels. The sanitized `tmp/n8n-workflow-harness/restart-report.json` records the old and new PIDs and checkpoints without resume URLs. This scenario covers an execution persisted at Wait in single-instance SQLite mode.

## Performance evidence

On Node 24.18.0 / Windows, 200 measured iterations after 10 warmups decoded and
validated a 256 KiB output page (349,988-byte uncompressed frame): median
2.46 ms, p95 4.71 ms, final process RSS 231,182,336 bytes. RSS is whole-process
resident memory, not per-page allocation or a regression comparison. Reproduce
with `node scripts/benchmark-action-io.mjs` after build. This measures no network,
database or native-process latency. Connection reuse is verified by a two-item
execution test (one factory invocation and one disposal), not claimed as a
measured end-to-end speedup. Native acceptance separately verifies control
progress while a long read is pending.

No production access, publication or feature activation is authorized. Local
fixtures/simulated transports are separate evidence from a real agent run.
Previous Hub/agent acceptance is not substituted for the node-specific evidence
above. The default-disabled production feature policy remains unchanged.
