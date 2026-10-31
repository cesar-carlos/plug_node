---
"n8n-nodes-plug-database": patch
---

Reduce npm package size by excluding development JavaScript source maps from the published tarball while retaining them in local builds. Preserve runtime JavaScript, declarations, JSON assets, icons, dependencies, and registered nodes/credentials. Validate that every built artifact except these maps is included in the tarball.
