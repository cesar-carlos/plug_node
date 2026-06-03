---
"n8n-nodes-plug-database": minor
---

Align the Plug Database node with hub contracts: emit one synthetic Aggregated JSON item when SQL returns zero rows, add guided `sql.bulkInsert`, expose `prefer_db_streaming` and batch parallel read options, map `replay_detected` (-32014) errors clearly, and decode PayloadFrame-wrapped `agents:command` socket responses for typeVersion 2.
