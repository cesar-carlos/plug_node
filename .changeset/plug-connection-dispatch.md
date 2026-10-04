---
"n8n-nodes-plug-database": minor
---

Separate hub wait, transport margin and connection deadlines, with an explicit 30-second default hub wait and SQL-aware batch/bulk timeouts. Validate incoming socket frames once per connection, reserve pending memory before decoding, isolate command ownership and agent stream hints, and cancel pending pulls and response work on completion or failure. Retain correlated inactivity timeouts for active streams, existing wire formats and the prohibition on ambiguous SQL retries. Bound gzip output while inflating, select measured gzip level 3 and add repeatable concurrency and compression measurements.
