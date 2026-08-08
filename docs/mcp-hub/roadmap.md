# Roadmap — Plug MCP Hub

Cada fase entrega valor sozinha. A V1 pode ir a produção sem a V2.

---

## Proto-V1 — legado de validação

Usar N nós `Plug Database` com `usableAsTool: true` + AI Agent nativo.

Útil só para smoke tests de semantic contract. **Sem** governance, audit envelope, `truncated`, nem validação prévia de params. O caminho suportado é a V1.

---

## V1 — Fundação (implementada)

**Status:** no pacote — `PlugMcpServer`, `PlugAiHub`, `shared/mcp/*`, `mcpCapabilityExecution`.

Providers: definitions **inline** (JSON ou Visual Builder). Sem wiring de nós filhos.

### Plug MCP Server

- Registry via JSON ou Visual Builder
- Operações: `list` | `call` | `validate`
- UX: dropdown de capability, params JSON ou resource mapper, `includeAuditInOutput`
- Governance: tipos/required/min/max, `requireAtLeastOneFilter`, `maxRows` efetivo, SELECT-only, mask, admin block, budget opcional (`toolCallCount`)
- Envelope MCP + audit opcional no item de saída

### Plug AI Hub

- Emite `{ systemPrompt, maxToolCallsPerTurn, forbiddenCapabilityNames }`
- Não executa capabilities; não injeta audit sozinho
- Wiring manual: ver [examples/README.md](./examples/README.md)

### Pack piloto

Oito capabilities em [examples/pilot-capabilities.json](./examples/pilot-capabilities.json). Validação em produção do cliente fica fora do pacote.

### Critérios V1

- [x] MCP Server + AI Hub no pacote
- [x] `tools/list` / `tools/call` / `validate`
- [x] Params + governance + SELECT-only + admin block
- [x] Audit no output (opcional via `includeAuditInOutput`)
- [x] Visual Builder + resource mapper + loadOptions
- [x] Pack piloto + workflow de referência em `examples/`
- [x] Docs de authoring alinhadas à implementação
- [ ] Piloto validado em produção do cliente
- [ ] Wiring automático AI Hub → MCP Server (hoje Code node / expressões)

### Fora da V1

Resources estáticos, sub-workflows, REST externo, SQL livre, clientes MCP fora do n8n, auto-discovery de nós no canvas.

---

## V2 — Conhecimento e composição

- Resources somente leitura (`erp://glossario`, políticas, manuais)
- Provider sub-workflow (capabilities compostas)
- Provider REST/Webhook externo
- Versionamento semântico de capabilities
- Descoberta semântica (tags / top-K no catálogo)

---

## V3 — Escala e SQL assistido

- Consulta livre governada (schema parcial + whitelist + auditoria do SQL gerado)
- Auto-discovery de nós Plug no canvas
- Templates por vertical
- Clientes MCP externos (stdio/SSE) com o mesmo registry
- Marketplace de capabilities

---

## Resumo

| Entrega                                   | V1  | V2  | V3  |
| ----------------------------------------- | --- | --- | --- |
| Plug MCP Server + AI Hub                  | X   |     |     |
| Definitions SQL + Tools + governance      | X   |     |     |
| Authoring UX (validate, visual, mapper)   | X   |     |     |
| Pack piloto + workflow referência         | X   |     |     |
| Resources / sub-workflow / REST           |     | X   |     |
| SQL assistido / MCP externo / marketplace |     |     | X   |

---

## Decisões já tomadas (V1)

| Tópico                | Decisão                                                              |
| --------------------- | -------------------------------------------------------------------- |
| Host do transporte    | Nó n8n `Plug MCP Server`                                             |
| Registro              | Manual (JSON / Visual); auto-discovery = V3                          |
| Escopo do catálogo    | Por workflow / instância do nó                                       |
| `usableAsTool` vs MCP | Coexistem; MCP é o caminho governado                                 |
| Audit                 | Campo `audit` no output; correlação via `auditSessionId` do workflow |

Decisões abertas (V2+): destino externo de audit, ranking semântico, superfície de SQL assistido.

Mudanças publicadas exigem Changeset e SemVer — [versioning-strategy.md](../versioning-strategy.md).
