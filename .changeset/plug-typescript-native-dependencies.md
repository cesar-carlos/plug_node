---
"n8n-nodes-plug-database": patch
---

Update runtime dependencies and compile the package with TypeScript 7 while preserving CommonJS loading and the existing node, credential, and JSON-RPC contracts. Keep Zod 3 for n8n peers and use an isolated Zod 4 alias for Plug validation, preserving public error messages and SQL refinements. Adapt PDF.js cleanup to release loading resources on success and failure, and validate installed packages with both supported n8n-workflow profiles.
