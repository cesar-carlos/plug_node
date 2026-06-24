# Capability Nodes — Como modelar nós Plug como capacidades

Este documento define como criar e configurar nós de consulta no workflow para que o MCP Server os exponha corretamente à IA.

## Princípio

Um capability node é uma **instância pré-configurada** do `Plug Database` (ou outro nó) com propósito único. O autor do fluxo define tudo: SQL, tabelas, parâmetros, limites. A IA só enxerga o contrato semântico.

```
Autor define (fixo no nó):         IA controla (parâmetros):
  SELECT TOP :limite                  :limite        → 50
  FROM TituloReceber t                :codCliente    → 42
  JOIN Cliente c ON ...               :dataCorte     → null
  WHERE t.Vencimento < GETDATE()
    AND t.CodCliente = :codCliente
```

## Estrutura de um capability node

### 1. Identidade

- **Nome no canvas:** nome de negócio, não técnico. Exemplos:
  - `Consultar Cliente` (não `Plug Database`)
  - `Contas a Receber Vencidas` (não `Execute SQL`)
  - `Saldo em Estoque` (não `plugDatabase`)
- **Categoria:** financeiro, crm, estoque, automação, documentos
- **Tags para busca semântica:** termos que a IA pode usar para encontrar a capability

### 2. Semantic contract

Descrição que o MCP Server publica. Deve responder três perguntas:

**Quando usar** — situações onde essa capability é a certa:

> "Listar títulos em aberto com vencimento anterior à data atual. Use para verificar inadimplência, preparar cobrança ou consultar saldo devedor."

**Quando não usar** — evita que a IA chame a capability errada:

> "Não use para consultar cadastro do cliente, histórico de pedidos ou fluxo de caixa futuro."

**Parâmetros disponíveis** — o que a IA pode preencher, formato e regras:

> "`codCliente` (number, opcional) — filtra por código do cliente. `limite` (number, default 50, máximo 100) — quantidade de registros. Informe ao menos `codCliente` para consultas específicas."

### 3. SQL base

Regras para o SQL base dos nós de consulta:

- Sempre `SELECT` — nunca `UPDATE`, `DELETE`, `INSERT`, `DROP`
- `TOP :limite` ou equivalente obrigatório — nunca sem limite
- Tabelas e colunas explícitas — sem `SELECT *` em nós de produção
- Joins definidos pelo autor — a IA não acrescenta joins
- Filtros estruturais fixos no SQL (ex.: `WHERE t.Ativo = 1`)
- Filtros dinâmicos via named params (ex.: `AND (:codCliente IS NULL OR t.CodCliente = :codCliente)`)
- Ordenação definida pelo autor
- Named params validados pelo guided SQL do plug_node

Padrão para filtros opcionais:

```sql
AND (:codCliente IS NULL OR t.CodCliente = :codCliente)
AND (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)
```

Isso permite que a IA omita um parâmetro passando `null` sem quebrar a query.

### Tratamento de resultados truncados

Quando o número de linhas retornadas iguala o `TOP :limite` configurado, o resultado pode estar truncado — há mais registros no banco que não foram retornados. O MCP Server sinaliza isso com `truncated: true` no envelope de resposta.

O semantic contract da capability deve mencionar essa limitação para que a IA informe o usuário:

> "Esta consulta retorna no máximo [N] registros. Se o resultado aparecer incompleto, adicione filtros mais específicos (ex.: cliente, período) para refinar."

Ao receber `truncated: true`, a IA deve:

1. Informar ao usuário que o resultado foi parcial
2. Sugerir um filtro adicional para obter dados mais precisos
3. Nunca afirmar que a lista está completa quando `truncated: true`

### Tratamento de resultado vazio

O plug_node retorna `__plug.emptyResult: true` quando `rows: []`. O MCP Server converte isso para `emptyResult: true` no envelope. A IA informa ao usuário que não há registros para os filtros informados.

Nunca tratar resultado vazio como erro ou indisponibilidade do sistema.

### 4. Parâmetros expostos à IA

Regras:

- Expor apenas o que a IA realmente precisa decidir
- Parâmetros técnicos (agentId, channel, resource, operation) nunca são expostos
- Parâmetros de negócio com nomes claros: `codCliente`, `nomeCliente`, `dataInicio`, `limite`
- Definir tipo, obrigatoriedade e valor padrão para cada parâmetro
- Parâmetros com valores fixos (ex.: sempre REST, sempre agentId X) ficam na configuração interna do nó

### 5. Governance no nó

Configurações mínimas para nós expostos à IA:

| Configuração                    | Valor recomendado    | Motivo                             |
| ------------------------------- | -------------------- | ---------------------------------- |
| `TOP :limite` no SQL            | Obrigatório          | Evita full scan                    |
| Max Rows                        | 100                  | Teto absoluto de registros         |
| Require WHERE for UPDATE/DELETE | Habilitado (default) | Proteção para mutações             |
| Channel                         | REST                 | Previsível para consultas pontuais |
| Response Mode                   | Aggregated JSON      | Resultado único normalizado        |
| Input Mode                      | Guided               | Ativa validateGuidedSql            |

## Catálogo piloto — ERP típico

### CRM

#### Consultar Cliente

```yaml
nome: Consultar Cliente
categoria: crm
tags: [cliente, telefone, endereço, cadastro, contato, email]
quando_usar: |
  Buscar dados cadastrais de um cliente: nome, telefone, e-mail, endereço, CNPJ.
  Use para identificar o cliente antes de consultar financeiro ou histórico.
quando_nao_usar: |
  Não use para financeiro, pedidos, estoque ou qualquer alteração de cadastro.
parametros:
  codCliente: { tipo: number, obrigatorio: false, descricao: Código do cliente no ERP }
  nomeCliente:
    { tipo: string, obrigatorio: false, descricao: Nome parcial — aceita % para busca }
  limite: { tipo: number, default: 10, maximo: 50 }
```

SQL base:

```sql
SELECT TOP :limite
  c.CodCliente,
  c.Nome,
  c.Telefone,
  c.Email,
  c.Cidade,
  c.Estado,
  c.CNPJ
FROM Cliente c
WHERE c.Ativo = 1
  AND (:codCliente IS NULL OR c.CodCliente = :codCliente)
  AND (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)
ORDER BY c.Nome;
```

---

### Financeiro

#### Contas a Receber Vencidas

```yaml
nome: Contas a Receber Vencidas
categoria: financeiro
tags: [contas a receber, vencido, inadimplente, cobrança, débito, título]
quando_usar: |
  Listar títulos com vencimento anterior à data atual.
  Use para cobrança, análise de inadimplência e saldo devedor do cliente.
quando_nao_usar: |
  Não use para títulos a vencer, baixa de títulos ou fluxo de caixa.
  Não use para consultar cadastro do cliente.
parametros:
  codCliente: { tipo: number, obrigatorio: false }
  nomeCliente: { tipo: string, obrigatorio: false }
  limite: { tipo: number, default: 50, maximo: 100 }
```

SQL base:

```sql
SELECT TOP :limite
  t.NumeroTitulo,
  c.CodCliente,
  c.Nome,
  t.Valor,
  t.Vencimento,
  t.Situacao,
  DATEDIFF(day, t.Vencimento, GETDATE()) AS DiasAtraso
FROM TituloReceber t
INNER JOIN Cliente c ON c.CodCliente = t.CodCliente
WHERE t.Vencimento < CAST(GETDATE() AS date)
  AND t.Situacao NOT IN ('Baixado', 'Cancelado')
  AND (:codCliente IS NULL OR t.CodCliente = :codCliente)
  AND (:nomeCliente IS NULL OR c.Nome LIKE :nomeCliente)
ORDER BY t.Vencimento ASC;
```

---

#### Contas a Receber a Vencer

```yaml
nome: Contas a Receber a Vencer
categoria: financeiro
tags: [contas a receber, a vencer, fluxo de caixa, previsão]
quando_usar: |
  Listar títulos com vencimento a partir de hoje.
  Use para previsão de recebimento e fluxo de caixa.
quando_nao_usar: |
  Não use para vencidos, baixas ou inadimplência.
parametros:
  codCliente: { tipo: number, obrigatorio: false }
  diasAdiante:
    { tipo: number, default: 30, descricao: Quantidade de dias à frente para filtrar }
  limite: { tipo: number, default: 50, maximo: 100 }
```

SQL base:

```sql
SELECT TOP :limite
  t.NumeroTitulo,
  c.CodCliente,
  c.Nome,
  t.Valor,
  t.Vencimento
FROM TituloReceber t
INNER JOIN Cliente c ON c.CodCliente = t.CodCliente
WHERE t.Vencimento >= CAST(GETDATE() AS date)
  AND t.Vencimento <= DATEADD(day, :diasAdiante, CAST(GETDATE() AS date))
  AND t.Situacao NOT IN ('Baixado', 'Cancelado')
  AND (:codCliente IS NULL OR t.CodCliente = :codCliente)
ORDER BY t.Vencimento ASC;
```

---

### Estoque

#### Saldo em Estoque

```yaml
nome: Saldo em Estoque
categoria: estoque
tags: [estoque, produto, saldo, quantidade, disponível]
quando_usar: |
  Consultar quantidade disponível de um produto.
  Use para verificar disponibilidade antes de confirmar pedido.
quando_nao_usar: |
  Não use para preço, cadastro do produto ou movimentação de estoque.
parametros:
  codProduto: { tipo: string, obrigatorio: false }
  nomeProduto: { tipo: string, obrigatorio: false }
  limite: { tipo: number, default: 20, maximo: 50 }
```

SQL base:

```sql
SELECT TOP :limite
  p.CodProduto,
  p.Descricao,
  e.Saldo,
  e.SaldoReservado,
  e.SaldoDisponivel,
  p.UnidadeMedida
FROM Produto p
INNER JOIN Estoque e ON e.CodProduto = p.CodProduto
WHERE p.Ativo = 1
  AND (:codProduto IS NULL OR p.CodProduto = :codProduto)
  AND (:nomeProduto IS NULL OR p.Descricao LIKE :nomeProduto)
ORDER BY p.Descricao;
```

---

### Automação Plug

#### Publicar Evento de Status

```yaml
nome: Publicar Evento de Status
categoria: automacao
tags: [evento, socket, notificação, status, atualização]
quando_usar: |
  Publicar um evento customizado no socket do Plug para notificar o ERP
  ou outros consumidores sobre uma mudança de status ou ação executada.
quando_nao_usar: |
  Não use para consultar dados. Não use para enviar mensagens ao usuário.
parametros:
  eventName:
    { tipo: string, obrigatorio: true, exemplo: "client:custom.cobranca.enviada" }
  payloadJson: { tipo: object, obrigatorio: true, descricao: Dados do evento em JSON }
```

Provider: `Plug Database > Resource = Tools > Publish Socket Event`

---

## Checklist antes de publicar um capability node

- [ ] SQL é `SELECT` — sem mutações
- [ ] `TOP :limite` presente no SQL
- [ ] Max Rows configurado no nó (máximo 100 para tools de IA)
- [ ] Todos os named params têm entrada no Named Params JSON
- [ ] Filtro opcional usa padrão `(:param IS NULL OR campo = :param)`
- [ ] Nome do nó no canvas é de negócio, não técnico
- [ ] Descrição cobre quando usar e quando não usar
- [ ] Testado com zero linhas (`__plug.emptyResult: true`)
- [ ] Testado com permissão negada pelo client token
- [ ] Client token com acesso mínimo às tabelas necessárias
- [ ] Sem Advanced JSON-RPC — modo Guided ativo
- [ ] Channel = REST para consultas pontuais
- [ ] Sem Resource = Client Access ou User Access

## Tipos de nó não permitidos como capabilities de agente

| Nó / Resource                                          | Motivo                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `Plug Database Socket Event Trigger`                   | É fonte de evento, não ferramenta de consulta              |
| `Plura.ai Automations Trigger`                         | Mesmo motivo                                               |
| `Resource = Client Access`                             | Administração de tokens — não expor à IA de atendimento    |
| `Resource = User Access`                               | Administração de agentes — exclusivo para admin            |
| `Execute SQL` em modo Advanced JSON-RPC                | Sem validação guided; escape hatch apenas                  |
| Qualquer nó com `UPDATE`/`DELETE`/`INSERT` no SQL base | Mutação direta — exige nó de ação dedicado com confirmação |
