# Architecture — Plug MCP Hub

## Camadas

```
┌─────────────────────────────────────────────┐
│  Camada 1 — Comportamento da IA             │
│  Plug AI Hub (system prompt + políticas)    │
├─────────────────────────────────────────────┤
│  Camada 2 — Catálogo + protocolo MCP-style  │
│  Plug MCP Server (registry + governance)    │
├─────────────────────────────────────────────┤
│  Camada 3 — Execução de capabilities        │
│  Definitions inline → mcpCapabilityExecution│
├─────────────────────────────────────────────┤
│  Camada 4 — Infraestrutura existente        │
│  shared core + plug_server + agente ERP     │
└─────────────────────────────────────────────┘
```

Misturar responsabilidades entre camadas é o principal risco. A V1 **não** delega a nós Plug Database filhos no canvas.

## Componentes

### Plug AI Hub (camada 1)

Só emite configuração. Não executa SQL nem Tools.

```json
{
  "systemPrompt": "...",
  "maxToolCallsPerTurn": 3,
  "forbiddenCapabilityNames": []
}
```

Wire para:

- system message do AI Agent (`systemPrompt`)
- campos do Plug MCP Server (`maxToolCallsPerTurn`, `forbiddenCapabilityNamesJson`)

Padrão suportado: [examples/README.md](./examples/README.md).

### Plug MCP Server (camada 2)

Contrato MCP-style dentro do n8n:

| Operação   | Função                                                |
| ---------- | ----------------------------------------------------- |
| `list`     | Catálogo `tools/list` (omite admin + nomes proibidos) |
| `call`     | Validar → governar → executar → envelope              |
| `validate` | Parse/checagem das definitions sem executar           |

Authoring:

- **JSON** — `capabilityDefinitionsJson` (import/export, pack piloto)
- **Visual Builder** — formulário que serializa o mesmo `CapabilityDefinition`

UX de call:

- Dropdown de capability (`loadOptions` do registry atual)
- Params em JSON **ou** resource mapper gerado pela capability
- `includeAuditInOutput` (default `true`; use `false` no branch do agente)
- Budget opcional: com `maxToolCallsPerTurn` > 0, `toolCallCount` omitido/`0` conta como chamada `#1`
- Processa **todos** os input items (list / call / validate)
- `validate` falha se o registry incluir capabilities admin (`clientAccess` / `userAccess`)

Governance já aplicada:

- Validação de tipo / required / min / max
- `requireAtLeastOneFilter`
- `maxRows` efetivo = `min(governance, execution, limite|limit)`
- SQL SELECT-only + named params guided
- Bloqueio admin `clientAccess` / `userAccess`
- Máscara → `[redacted]`
- Erros amigáveis (sem leak técnico)

### Definitions (camada 3)

Cada entrada do registry tem:

- Campos semânticos (`name`, `displayName`, `description`, `whenToUse`, `whenNotToUse`, `category`, `tags`)
- Schema `parameters`
- `governance`
- `executionConfig` (`sql` ou `tools`)

Execução via `shared/n8n/mcpCapabilityExecution`. Sem provider por nó filho na V1.

### Infraestrutura (camada 4)

Inalterada:

```
MCP Server
  → shared/n8n (session, guided SQL / Tools)
  → shared/rest ou shared/socket
  → plug_server (auth, policy, rate limit, replay)
  → agente ERP → banco
```

## Fluxo de execução

```
1. Workflow monta config do AI Hub (+ Code node de wiring, se usado)
2. Path do agente chama MCP Server list → catálogo
3. Agente chama MCP Server call com capabilityName + params
4. Server valida params e governance
5. Server executa SQL/Tools via transporte compartilhado
6. Item de resposta: content + meta
7. audit só se includeAuditInOutput=true
8. Branch do agente deve encaminhar content + meta (sem audit)
```

## Matriz de responsabilidade

| Responsabilidade               | AI Hub | MCP Server    | Definition      | Infra |
| ------------------------------ | ------ | ------------- | --------------- | ----- |
| Prompt / tom / escopo          | X      |               |                 |       |
| Regras de tool no prompt       | X      |               |                 |       |
| Catálogo de capabilities       |        | X             |                 |       |
| Validação de params de negócio |        | X             |                 |       |
| Filtros / máscara              |        | X             | X (SQL filters) |       |
| Campo audit no output          |        | X             |                 |       |
| SQL / Tools fixos              |        |               | X               |       |
| SELECT-only / admin block      |        | X             |                 |       |
| maxRows efetivo                |        | X             | X               |       |
| Auth hub / rate limit / policy |        |               |                 | X     |
| Validação guided SQL           |        | X (pré-check) |                 | X     |

## Contrato de saída (`tools/call`)

```json
{
  "content": [{ "type": "text", "text": "<JSON rows ou mensagem amigável>" }],
  "meta": {
    "capability": "contas_receber_vencidas",
    "rowCount": 50,
    "truncated": true,
    "executionMs": 312,
    "emptyResult": false
  },
  "isError": false,
  "audit": { "...opcional..." }
}
```

Regras:

- `content[0].text` = JSON das rows ou mensagem amigável (vazio/erro)
- `meta.truncated` = `true` quando `!emptyResult && rowCount >= maxRows` efetivo
- `meta.emptyResult` espelha resultado vazio do Plug
- Falhas Plug → `isError: true` com texto amigável
- Credenciais/tokens nunca em `content`
- Não encaminhar `audit` ao modelo; persistir à parte se precisar

### maxRows efetivo

`min(governance.maxRows, executionConfig.maxRows, limite|limit dos params)`

Em Tools, o max de execução cai no governance max; `limite`/`limit` ainda entram se existirem.

## Wiring de audit

O AI Hub **não** injeta audit sozinho. O workflow preenche no MCP Server:

- `auditUserId` (default `anonymous`)
- `auditSessionId` (vazio → UUID **por call** — ruim para correlacionar conversa)
- `includeAuditInOutput`
- `maxToolCallsPerTurn` + `toolCallCount` para budget duro

Padrão: [examples/README.md](./examples/README.md).

## Hosting e protocolo

| Tópico                  | V1                             |
| ----------------------- | ------------------------------ |
| Host                    | Nó `Plug MCP Server`           |
| Declaração de protocolo | `2024-11-05`                   |
| Transporte              | Interno ao n8n (sem stdio/SSE) |
| Clientes MCP externos   | Roadmap V3                     |

## Relação com `usableAsTool`

`Plug Database` com `usableAsTool: true` continua válido para agentes mínimos.

Fluxos multi-capability governados:

`AI Agent + Plug AI Hub + Plug MCP Server`

— não N nós Plug Database no canvas como registry principal.
