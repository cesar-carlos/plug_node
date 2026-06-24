# Plug MCP Hub — Planejamento

Esta pasta documenta o levantamento, objetivos e planejamento de implementação do **Plug MCP Hub**: a camada que expõe nós Plug como capacidades de negócio consumíveis por agentes de IA.

## Contexto

O `plug_node` já entrega execução SQL, tools, Socket e acesso via REST ao `plug_server`. O que falta é a **camada semântica** entre "nó técnico de SQL" e "capability de negócio para IA" — de forma que quem constrói o fluxo não precise repetir configuração em cada workflow e a IA receba um catálogo estruturado, seguro e governado.

## Documentos

| Documento                                    | Conteúdo                                            |
| -------------------------------------------- | --------------------------------------------------- |
| [overview.md](./overview.md)                 | Problema, visão, conceitos principais               |
| [architecture.md](./architecture.md)         | Camadas, componentes e responsabilidades            |
| [capability-nodes.md](./capability-nodes.md) | Como modelar nós Plug como capabilities             |
| [ai-hub-rules.md](./ai-hub-rules.md)         | Regras de comportamento, guardrails e system prompt |
| [roadmap.md](./roadmap.md)                   | Fases de implementação V1, V2 e V3                  |

## Relação com o pacote atual

O MCP Hub **não substitui** o `Plug Database`. Ele adiciona a camada de orquestração semântica acima dos nós existentes:

```
IA
 ↓
Plug MCP Hub  ←  este planejamento
 ↓
Plug Database (plug_node)
 ↓
plug_server hub
 ↓
Agente ERP
```

Nenhum contrato de transporte, auth ou validação existente é alterado. O hub MCP delega toda execução aos nós Plug já testados e publicados.
