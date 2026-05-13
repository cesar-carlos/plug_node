---
"n8n-nodes-plug-database": major
---

Consolidate Plug Database into a single package. The canonical package now includes REST, consumer Socket execution, Socket Event publish/listen support, the Socket Event trigger, and the Plura.ai Automations trigger.

The former `n8n-nodes-plug-database-advanced` package is removed from this workspace and should be deprecated on npm after release. Saved workflows that reference advanced-only node type names such as `plugDatabaseAdvanced`, `plugDatabaseAdvancedSocketEventTrigger`, `plugDatabaseAdvancedPdf`, or `plugDatabaseAdvancedBarcode` must be migrated to the unified `Plug Database` node or the renamed `Plug Database Socket Event Trigger`.
