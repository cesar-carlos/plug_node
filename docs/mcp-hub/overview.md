# Overview — Plug MCP Hub

## Problema

O `Plug Database` expõe uma superfície técnica ampla: SQL, Client Access, User Access, Tools, canais e opções avançadas. Ligado direto a um agente de IA, o modelo passa a gerenciar internos de ERP que não deveria controlar.

Para "quais clientes têm títulos vencidos?", o agente precisaria de tabelas, joins, guided SQL, canal e política de client token.

Isso não é trabalho do agente. Ele deve ver só **capacidades de negócio**.

O segundo problema é escala: N instâncias de Plug Database como tools não se mantêm.

## Objetivo

O autor configura consultas e ações uma vez. O sistema expõe essas capabilities de forma estruturada e governada.

A IA não vê SQL, JSON-RPC, tabelas nem internos do nó Plug. Vê capacidades como:

- Consultar Cliente
- Contas a Receber Vencidas
- Saldo em Estoque
- Publicar Evento de Status
- Gerar PDF de Documento

Cada capability é uma **definição** no **Plug MCP Server** (JSON ou Visual Builder). A IA escolhe a capability, preenche parâmetros de negócio e o Server executa via transporte Plug compartilhado.

## Fluxo em runtime

```
Usuário pergunta em linguagem natural
          ↓
AI Agent recebe o catálogo (tools/list)
          ↓
IA escolhe capability + parâmetros
          ↓
Plug MCP Server valida, governa, executa
          ↓
shared transport → plug_server → agente ERP
          ↓
Envelope MCP normalizado volta ao workflow / agente
          ↓
IA responde com dados reais
```

A IA nunca escreve SQL, não escolhe tabelas e não altera a config de execução.

## Conceitos

### Capability

Ferramenta de negócio que a IA pode chamar: nome técnico, contrato semântico (`whenToUse` / `whenNotToUse`), parâmetros, governance e config de execução.

### Provider (execution config)

Implementação técnica dentro da definição:

- `sql` — SQL read-only fixo com bindings nomeados (`:codCliente`, `:limite`, …)
- `tools` — operação allowlisted do Plug Tools (`validateCpfCnpj`, `publishSocketEvent`, …)

A IA não fala com o provider diretamente.

### Contrato semântico

O que a IA lê em `tools/list`: descrição, quando usar / não usar, schema de parâmetros.

### Contrato de governance

Regras aplicadas pelo MCP Server independentemente do modelo: filtros obrigatórios, `maxRows` efetivo, máscara de colunas (`[redacted]`), SQL SELECT-only, bloqueio de admin e budget opcional de tool calls.

## O que o MCP Hub não é

- Não substitui o `Plug Database` — fica acima do transporte compartilhado
- Não é daemon MCP HTTP/stdio na V1 — é nó n8n com contrato `tools/list` + `tools/call`
- Não é SQL livre para a IA
- Não é superfície admin (Client/User Access permanecem bloqueados)
- Não gerencia auth — credenciais e hub auth ficam no stack Plug

## Por onde começar

- Authoring: [capability-nodes.md](./capability-nodes.md)
- Arquitetura: [architecture.md](./architecture.md)
- Pack + wiring: [examples/](./examples/)
