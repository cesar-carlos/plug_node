---
"n8n-nodes-plug-database": patch
---

Reduce repeated SQL hint analysis, binary input buffer copies, and temporary allocations when admitting waiting Socket/relay readers. Preserve existing limits, credentials, transport behavior and workflow outputs, with regression coverage for reused binary buffers, reader capacity and full-page validation before output storage.
