---
"n8n-nodes-plug-database": patch
---

Present safe Portuguese diagnostics for unavailable, disabled, incompatible and unimplemented agent features across I/O, SQL extensions and legacy transports. Preserve structured error codes and recovery metadata without leaking native error prose or retrying availability failures. Explicit JSON-RPC method-not-found responses indicate non-execution; missing capabilities and timeouts do not imply an outdated agent or absence of effects.

Handle a correlated `relay:rpc.accepted` refusal immediately so it reaches the caller with its Hub diagnostics instead of timing out while waiting for a result.
