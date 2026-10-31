# Communication patterns

Choose the transport by resource. Authentication, catalog and access management use REST. The command paths below share a Hub login, but differ in how they handle a lost response.

| Resource                            | REST                                          | Socket on `/consumers`                                            | Recovery                                                                                                                                                    |
| ----------------------------------- | --------------------------------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Legacy SQL commands                 | `POST /api/v1/agents/commands`                | TypeVersion 2 prefers `agents:command`. TypeVersion 1 uses relay. | A failed capability probe can select relay for an eligible single command **before dispatch**. A timeout after emission does not trigger a switch to relay. |
| Agent Action I/O and SQL Extensions | Same bridge, dedicated single-dispatch client | Direct socket or a relay conversation with the selected agent     | No automatic replay, credential refresh retry, relay fast path or transport fallback. Use the original operation identity to inspect the outcome.           |

### REST flow

Legacy commands use the execution's client session. For login, refresh conditions and retry limits, see [Session refresh and retry behavior](./error-and-authorization-contracts.md#session-refresh-and-retry-behavior). Action I/O and SQL Extensions use the Hub account credential plus **Plug Agent API** for the agent ID and local credential. Discovery describes the catalog. The authenticated registration determines whether the feature is available.

### Socket command flow

Connect to `/consumers` with the Hub access token and wait for `connection:ready`. Direct SQL commands use `agents:command_response` and stream events when needed. Relay starts a conversation with `relay:conversation.start` before sending `relay:rpc.request`. In the dedicated client a correlated `relay:rpc.accepted` with `success:false` ends the call immediately. A successful acceptance is not the RPC result. The result arrives on `relay:rpc.response`. See [SQL over Socket](./socket/sql-socket.md) for probe, streaming, pull windows and legacy fast-path settings.

### Output rules

For SQL, response mode determines whether the workflow receives rows, aggregated JSON or Socket chunks. A successful empty result in aggregated mode emits one item with `rows: []` and `__plug.emptyResult: true`. See [error and output contracts](./error-and-authorization-contracts.md#empty-sql-result-sets). Faithful action output is binary. Persist the cursor and byte offsets after consuming each page. See [workflow use and recovery](./communication-alignment.md#workflow-use-and-safety).

### Custom Socket Events

Custom publish, wait and trigger operations have their own event lifecycle. See [custom events](./socket/custom-events.md) and the [Socket guide index](./socket/README.md).

### PayloadFrame handling

See [PayloadFrame](./socket/payload-frame.md) for encoding, compression and decoding limits. The [Hub contract index](./hub-contract-alignment.md) identifies the upstream references for each transport.
