---
"n8n-nodes-plug-database": patch
---

Stop scheduling input items after a parallel execution failure and wait for active work before returning the error. Preserve ordered delivery of large result arrays without argument-limit failures or intermediate array copies.

Classify read-only REST failures without reporting possible mutations and share method classification with Socket and relay, including SQL inspection and agent health. Count UTF-8 input bytes without allocating a temporary buffer during binary base64 decoding.

Evaluate SQL parallelism using each item's operation and input mode, exclude SELECT INTO from automatic read-only hints, and defer malformed JSON errors to per-item execution so continue-on-fail works. Reuse allocation-free UTF-8 size checks for base64 text encoding and decoding.

Reject coalesced batches with mismatched agents, client credentials, operations, modes or channels before dispatch, and preserve per-item errors by disabling coalescing for continue-on-fail. Enforce the merged command ceiling before mapping commands and replace sampled bulk insert size estimates with bounded exact UTF-8 JSON counting.

Validate RPC response and agent identities across REST, Socket and relay while preserving correlated legacy envelopes, numeric IDs and confirmed hub IDs. Enforce per-command row limits on unary relay batch responses and close failed conversations before returning errors.

Reject duplicate IDs in relay batch acceptance before registering waiters, and enforce complete REST and Socket batch responses while preserving notifications and legacy ID handling.

Prevent dispatch of cancelled relay commands and batches, count direct Socket batch rows against buffer limits, and reject notification acknowledgements in place of expected RPC results.
