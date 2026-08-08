# Capability Definitions — Como modelar capacidades

Este documento explica como criar capabilities no **Plug MCP Server**. Na V1, a capability **não** é um nó Plug Database no canvas: é uma definição (JSON ou Visual Builder) executada por `mcpCapabilityExecution`.

## Princípio

O autor fixa SQL (ou operação Tools), tabelas, parâmetros e limites. A IA só vê o contrato semântico (`tools/list`) e envia parâmetros de negócio (`tools/call`).

```
Autor define (na definição):          IA controla (params):
  SELECT TOP :limite                  :limite        → 50
  FROM TituloReceber t                :codCliente    → 42
  WHERE ...                           :dataCorte     → null
```

Caminhos de authoring:

| Modo               | Quando usar                                      |
| ------------------ | ------------------------------------------------ |
| **JSON**           | Import/export, pack piloto, versionamento no git |
| **Visual Builder** | Criar/editar capabilities no formulário do nó    |

O pack piloto pronto para colar está em [examples/pilot-capabilities.json](./examples/pilot-capabilities.json). Use **Operation = Validate Definitions** antes de ligar o agente.

> `usableAsTool: true` no Plug Database ainda funciona para agentes mínimos, **sem** governance do MCP Server.

## Estrutura de uma capability

### 1. Identidade

| Campo               | Regra                                               |
| ------------------- | --------------------------------------------------- |
| `name`              | Identificador técnico estável (`consultar_cliente`) |
| `displayName`       | Nome de negócio (`Consultar Cliente`)               |
| `category` / `tags` | Ajuda a IA a achar a tool certa                     |

### 2. Semantic contract

Campos publicados no catálogo:

- `description` — o que a capability faz
- `whenToUse` — quando escolher esta tool
- `whenNotToUse` — evita call errada
- `parameters` — schema tipado (tipo, required, default, min/max)

### 3. SQL (`providerType: "sql"`)

- Sempre `SELECT` (ou `WITH ... SELECT`) — mutações são rejeitadas
- `TOP :limite` (ou equivalente) no SQL
- Colunas explícitas — evite `SELECT *` em produção
- Joins e ordenação fixos pelo autor
- Filtros dinâmicos com named params:

```sql
AND (:codCliente IS NULL OR t.CodCliente = :codCliente)
AND (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)
```

Bindings `:nome` no SQL devem existir em `parameters` (validação na operação `validate` / no parse).

`executionConfig` típico:

```json
{
  "providerType": "sql",
  "sql": "SELECT TOP :limite ...",
  "channel": "rest",
  "maxRows": 50
}
```

### 4. Tools (`providerType: "tools"`)

Operação allowlisted do Plug Tools (ex.: `validateCpfCnpj`, `publishSocketEvent`, HTML→PDF). Params de negócio vêm do call; `staticParams` fixa o que a IA não deve escolher.

### 5. Governance

| Campo                     | Efeito                                                        |
| ------------------------- | ------------------------------------------------------------- |
| `maxRows`                 | Teto de linhas (combinado com execution + `limite`/`limit`)   |
| `requireAtLeastOneFilter` | Exige ao menos um filtro de `filterParamNames`                |
| `filterParamNames`        | Params que contam como filtro (devem existir em `parameters`) |
| `maskedColumns`           | Colunas substituídas por `[redacted]` no resultado            |

`maxRows` efetivo:

`min(governance.maxRows, executionConfig.maxRows, limite|limit dos params)`

### Truncamento e vazio

- `meta.truncated: true` quando `!emptyResult && rowCount >= maxRows` efetivo
- `meta.emptyResult: true` quando não há linhas — **não** é erro de sistema
- Com `truncated`, a IA deve avisar resultado parcial e sugerir filtros mais específicos

Mencione o teto no semantic contract quando fizer sentido.

### 6. Params expostos à IA

- Só params de negócio (`codCliente`, `limite`, …)
- Nunca agentId, channel, resource, credential, JSON-RPC cru
- Defina tipo, obrigatoriedade, default e bounds numéricos

## Checklist antes de publicar

- [ ] SQL é SELECT-only (se provider SQL)
- [ ] `TOP :limite` (ou equivalente) presente
- [ ] Named params do SQL batem com `parameters`
- [ ] `filterParamNames` ⊆ nomes em `parameters`
- [ ] `governance.maxRows` e `executionConfig.maxRows` coerentes
- [ ] `whenToUse` / `whenNotToUse` claros
- [ ] Validate Definitions OK no MCP Server (sem capabilities admin)
- [ ] Testado: param faltando, filtro obrigatório, vazio, truncado
- [ ] Sem `clientAccess` / `userAccess` no nome ou operação

## O que não pode ser capability de agente

| Superfície                         | Motivo                                        |
| ---------------------------------- | --------------------------------------------- |
| Client Access / User Access        | Admin — bloqueado pelo MCP Server             |
| Socket Event / Plura triggers      | Fontes de evento, não tools de consulta       |
| Advanced JSON-RPC livre            | Sem guided SQL — fora do contrato V1          |
| SQL com `UPDATE`/`DELETE`/`INSERT` | Mutação — rejeitada na governance SELECT-only |

## Pack piloto

As 8 capabilities de referência (CRM, financeiro, estoque, automação, compliance, documentos) vivem só em [examples/pilot-capabilities.json](./examples/pilot-capabilities.json). Não duplicar o catálogo neste arquivo.

Wiring AI Hub → MCP Server: [examples/README.md](./examples/README.md).
