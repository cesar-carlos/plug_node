---
"n8n-nodes-plug-database": patch
---

Speed up PayloadFrame HMAC verify (raw digest compare) and JSON parse (Buffer path), raise parallel chunk decode overlap to 8, and extend `bench:payload-frame:check` with async decode cases plus a refreshed baseline to catch performance regressions.
