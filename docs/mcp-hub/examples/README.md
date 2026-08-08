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

**Automatic (preferred):** Plug AI Hub emits a `wiring` block with `systemPrompt`, `maxToolCallsPerTurn`, and `forbiddenCapabilityNamesJson`. When MCP Server **Forbidden Capability Names JSON** stays at `[]` and **Max Tool Calls Per Turn** stays at `0`, those values are inherited from the input item `wiring` (or Hub-shaped top-level fields). For Agent tool branches that do not carry Hub output, set **AI Hub Node Name** to the Hub node name.

**Workflow-owned (still required):**

- `toolCallCount` — increment per user turn when a budget is set
- `auditSessionId` — stable chat/session id across turns
- `includeAuditInOutput` — usually `false` on the agent-facing branch
- `systemPrompt` — bind Hub output into the AI Agent system message (MCP Server does not consume it)

The reference workflow keeps a small Code node that spreads Hub `wiring` and adds session fields:

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

Map workflow-owned fields into Plug MCP Server:

- `Audit Session ID` ← `wiring.auditSessionId`
- `toolCallCount` ← `wiring.toolCallCount` (when `maxToolCallsPerTurn` is set and this is `0`/empty, the node treats the call as `#1`)
- `Include Audit In Output` ← `wiring.includeAuditInOutput`

`Operation = Validate Definitions` fails when the registry includes forbidden admin capabilities (`clientAccess` / `userAccess` naming).

## Recommended production checklist

- [ ] Paste / import `pilot-capabilities.json` and run **Validate Definitions**
- [ ] Run **List Capabilities** and confirm forbidden/admin names are absent
- [ ] Place **Plug AI Hub** upstream (or set **AI Hub Node Name**) so budget + forbidden names inherit without manual JSON
- [ ] Bind Hub `systemPrompt` into the AI Agent system message
- [ ] Keep `includeAuditInOutput=false` on the agent-facing branch
- [ ] Persist audit separately if you need compliance logs
- [ ] Increment `toolCallCount` per user turn when `maxToolCallsPerTurn` > 0
- [ ] Smoke **tools/call** with a filter + `maxRows` / masking capability from the pilot pack
- [ ] Smoke a SELECT-only SQL capability; confirm non-SELECT definitions fail validate/call governance
- [ ] Prefer Visual Builder for new capabilities; keep JSON for import/export

Client production sign-off remains outside this repository; use the checklist above as the gate before enabling the agent path.
