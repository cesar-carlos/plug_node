---
"n8n-nodes-plug-database": minor
---

Improve socket/relay throughput and streaming reliability: overlap PayloadFrame chunk decodes with ordered merge, strip stream_id once, cache accepted hub request ids, sync encode tiny stream-pull frames, soft-JWT auth update without reconnect, and aggregate seeded streams inside relay batches. Automatically omit relay fastPath for all sql.execute / sql.executeBatch commands so inadvertent agent streams can pull reliably. Align workspace/docs to Node 24.18.0.
