# Plug MCP Hub

Esta pasta documenta o **Plug MCP Hub**: a camada que expõe capacidades de negócio (SQL/Tools governados) a agentes de IA no n8n.

## Status da implementação

| Fase | Status | Notas |
| ---- | ------ | ----- |
| Proto-V1 (`usableAsTool`) | Disponível | Sem governance centralizada; útil só para smoke tests |
| V1 (MCP Server + AI Hub) | **Implementado** | Registry JSON/Visual; `list`/`call`/`validate`; SQL + Tools; governance; UX de authoring |
| V2 / V3 | Planejado | Ver [roadmap.md](./roadmap.md) |

## Documentos

| Documento | Conteúdo |
| --------- | -------- |
| [overview.md](./overview.md) | Problema, visão, conceitos |
| [architecture.md](./architecture.md) | Camadas, envelope, audit, responsabilidades |
| [capability-nodes.md](./capability-nodes.md) | Como authorar definitions (SQL/Tools + governance) |
| [ai-hub-rules.md](./ai-hub-rules.md) | Prompt, guardrails e comportamento da IA |
| [roadmap.md](./roadmap.md) | Fases V1–V3 |
| [examples/](./examples/) | Pack piloto + workflow de referência (**fonte de verdade UX**) |

## Relação com o pacote

O MCP Hub **não substitui** o `Plug Database`. Ele orquestra acima do transporte compartilhado:

```
IA / AI Agent
 ↓
Plug AI Hub (system prompt + limites)  +  Plug MCP Server (list | call | validate)
 ↓
shared/mcp + shared/n8n/mcpCapabilityExecution
 ↓
plug_server hub → Agente ERP
```

Na V1 as capabilities são definitions no **Plug MCP Server** (JSON ou Visual Builder). Não há discovery de nós filhos no canvas. Credenciais e auth continuam no stack Plug.

Começo rápido: [examples/pilot-capabilities.json](./examples/pilot-capabilities.json) + [examples/mcp-hub-reference.workflow.json](./examples/mcp-hub-reference.workflow.json).
