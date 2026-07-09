---
"n8n-nodes-plug-database": patch
---

Harden Plug server communication retries and socket safety: no double-execution on socket timeouts or agents:command→relay fallback after emit; auto-omit relay fastPath for streaming-capable commands; refresh TOKEN_EXPIRED without HTTP status; fix stream credit races and pull abort accounting; clear stuck Socket Event Trigger reconnecting flag; gate Client/User Access transient retries to safe list/get ops; map HTTP timeouts to PlugTimeoutError; parse Retry-After HTTP-dates and cap delays; treat RPC -32013 as retryable; align consumer/relay app:error retryable codes; trim PayloadFrame signature key_id on encode.
