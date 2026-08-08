---
"n8n-nodes-plug-database": patch
---

Harden Socket SQL/relay and Socket Event Trigger: serialize relay executes per agent, defer transport dispose under refcount, map classic batch accept failures, clean batch response listeners on timeout, reject orphaned parallel chunk decodes, serialize trigger reconnects with single circuit accounting, fix dropOldest with maxQueueSize=0, persist event-id dedupe across reconnects, and recreate idle sockets on JWT rotation.
