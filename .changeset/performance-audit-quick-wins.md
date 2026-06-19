---
"n8n-nodes-plug-database": minor
---

Improve socket performance defaults: adaptive stream pull window (`0` omits explicit override), honor configured pull window above agent recommendation, relay fast path default on typeVersion 1, omit traceId on relay command frames, and sample-based bulk insert size validation.
