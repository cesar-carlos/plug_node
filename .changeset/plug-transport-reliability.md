---
"n8n-nodes-plug-database": patch
---

Align PayloadFrame compression with the hub inflation limit and reject oversized payloads before allocation. Enforce required signatures on legacy consumer JSON, reuse renewed sessions for late parallel auth failures, and isolate command activity and timing metrics on shared sockets. Reject aborted or failed streams before returning partial data. Avoid automatic SQL redispatch after REST timeouts, HTTP 5xx, ambiguous transport failures, or rejected stream pulls.
