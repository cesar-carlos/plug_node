---
"n8n-nodes-plug-database": patch
---

Fix local SQL analysis so quotes and comment delimiters inside comments cannot hide mutations or required named parameters, and comments do not merge SQL keywords. Share lexical masking between guided SQL validation and performance hints, including nested block comments, without rewriting dispatched SQL.

Preserve the first cancellation or timeout reason while Read Complete Output finishes an in-flight binary storage write. Keep the checkpoint aligned with stored bytes across REST, Socket and relay.
