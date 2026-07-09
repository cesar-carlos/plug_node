# Plug MCP Hub

Esta pasta documenta o **Plug MCP Hub**: a camada que expõe nós Plug como capacidades de negócio consumíveis por agentes de IA.

## Status da implementação

| Fase | Status | Notas |
| ---- | ------ | ----- |
| Proto-V1 (`usableAsTool`) | Disponível | Sem governance centralizada |
| V1 (MCP Server + AI Hub) | **Implementado (parcial)** | Registry JSON inline; SQL + Tools; governance básica |
| V2 / V3 | Planejado | Ver [roadmap.md](./roadmap.md) |

## Documentos

| Documento | Conteúdo |
| --------- | -------- |
| [overview.md](./overview.md) | Problema, visão, conceitos principais |
| [architecture.md](./architecture.md) | Camadas, componentes e responsabilidades |
| [capability-nodes.md](./capability-nodes.md) | Como modelar capabilities (SQL base + params) |
| [ai-hub-rules.md](./ai-hub-rules.md) | Regras de comportamento, guardrails e system prompt |
| [roadmap.md](./roadmap.md) | Fases V1, V2 e V3 |

## Relação com o pacote atual

O MCP Hub **não substitui** o `Plug Database`. Ele adiciona a camada de orquestração semântica acima do transporte existente:

```
IA / AI Agent
 ↓
Plug AI Hub (system prompt + limites)  +  Plug MCP Server (tools/list | tools/call)
 ↓
shared/mcp + shared/n8n/mcpCapabilityExecution
 ↓
plug_server hub → Agente ERP
```

Na V1, as capabilities são definidas em `capabilityDefinitionsJson` no nó **Plug MCP Server** (SQL embutido ou Tools). A execução reutiliza o stack Plug (auth, REST/Socket, guided SQL). Nós filhos no canvas como providers ficam para evolução futura.
