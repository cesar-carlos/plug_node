# Plug MCP Hub — Examples

Copy-ready V1 assets. This folder is the **UX source of truth** for the pilot pack and AI Hub → MCP Server wiring (conceptual docs link here instead of duplicating catalogs).

## Files

| File                                                                   | Purpose                                                                       |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`pilot-capabilities.json`](./pilot-capabilities.json)                 | Full pilot capability pack (8 capabilities) for `Capability Definitions JSON` |
| [`mcp-hub-reference.workflow.json`](./mcp-hub-reference.workflow.json) | Importable n8n workflow showing AI Hub → wiring → Switch → MCP Server         |

## How to use the pilot pack

1. Open **Plug MCP Server**
2. Keep **Authoring Mode = JSON**
3. Paste the contents of `pilot-capabilities.json` into **Capability Definitions JSON**
4. Run **Operation = Validate Definitions** once to confirm the pack parses
5. Use **Operation = List Capabilities** to publish the catalog to your AI Agent path

## How to wire AI Hub → MCP Server

The reference workflow uses a small Code node that emits:

```json
{
  "wiring": {
    "systemPrompt": "...",
    "maxToolCallsPerTurn": 5,
    "forbiddenCapabilityNamesJson": "[]",
    "auditSessionId": "<stable conversation id>",
    "toolCallCount": 1,
    "includeAuditInOutput": false
  }
}
```

Map those fields into Plug MCP Server:

- `Forbidden Capability Names JSON` ← `wiring.forbiddenCapabilityNamesJson`
- `Max Tool Calls Per Turn` ← `wiring.maxToolCallsPerTurn`
- `toolCallCount` ← incremented by the workflow on each call (when `maxToolCallsPerTurn` is set and this is `0`/empty, the node treats the call as `#1`)
- `Audit Session ID` ← stable chat/session id (do not leave empty across turns)
- `Include Audit In Output` ← `false` when the item goes back to an AI Agent

`Operation = Validate Definitions` fails when the registry includes forbidden admin capabilities (`clientAccess` / `userAccess` naming).
## Recommended production checklist

- [ ] Validate definitions before enabling the agent path
- [ ] Keep `includeAuditInOutput=false` on the agent-facing branch
- [ ] Persist audit separately if you need compliance logs
- [ ] Increment `toolCallCount` per user turn
- [ ] Prefer Visual Builder for new capabilities; keep JSON for import/export
