---
"n8n-nodes-plug-database": patch
---

Update stable runtime and development dependencies, including Playwright, jose, marked, to-words, the Zod 4 alias, n8n tooling, ESLint, and Vitest. Preserve the Zod 3 host peer and Node 24 type compatibility. Normalize uncaught execution errors at node boundaries, validate pinned self-hosted runtime dependencies, and update the native compatibility installation profiles. Refresh transitive resolutions and constrain qs to its corrected version.

Adopt corrected Portuguese number wording from to-words 7.4.1: for example, 1001 now returns "Mil E Um" instead of "Mil Um". Node operations and parameters remain unchanged.
