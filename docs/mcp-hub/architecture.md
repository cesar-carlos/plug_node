# Arquitetura — Plug MCP Hub

## Camadas

O sistema é organizado em quatro camadas com responsabilidades distintas. Misturar responsabilidades entre camadas é o principal risco de implementação.

```
┌─────────────────────────────────────────────┐
│  Camada 1 — Comportamento da IA             │
│  Plug AI Hub (system prompt + políticas)    │
├─────────────────────────────────────────────┤
│  Camada 2 — Catálogo e protocolo            │
│  Plug MCP Server (registry + MCP)           │
├─────────────────────────────────────────────┤
│  Camada 3 — Execução de capabilities        │
│  Nós de consulta Plug Database              │
├─────────────────────────────────────────────┤
│  Camada 4 — Infraestrutura (existente)      │
│  plug_node shared core + plug_server + ERP  │
└─────────────────────────────────────────────┘
```

## Componentes

### Plug AI Hub (Camada 1)

Nó n8n que funciona como ponto de entrada da IA. Hospeda as regras de comportamento, limites operacionais e o system prompt.

Responsabilidades:

- Definir identidade e escopo da IA
- Estabelecer o que a IA pode e não pode fazer
- Limitar número de tool calls por turno
- Garantir que erros técnicos não sejam expostos ao usuário final
- Conectar-se ao Plug MCP Server como fonte de capabilities

O AI Hub **não executa SQL nem chama o hub** diretamente. Ele delega ao MCP Server.

### Plug MCP Server (Camada 2)

Nó n8n que implementa o protocolo MCP e mantém o registry de capabilities.

Responsabilidades:

- Registrar as capabilities disponíveis no fluxo (`tools/list`)
- Executar a capability solicitada pela IA (`tools/call`)
- Validar parâmetros antes de delegar ao nó de consulta
- Aplicar governance: filtros obrigatórios, limites de registros, campos proibidos
- Registrar auditoria de cada execução: capability, parâmetros, usuário, duração, resultado
- Expor resources estáticos: glossário ERP, políticas, manual de operação

O MCP Server **não sabe SQL** e **não acessa o banco diretamente**. Ele delega para os nós de consulta.

### Nós de Consulta Plug Database (Camada 3)

Instâncias pré-configuradas de `Plug Database` ligadas ao MCP Server como providers de capability.

Cada nó representa uma única capability de negócio. Contém:

- SQL base fixo com named params (`:codCliente`, `:limite`, etc.)
- Resource, Operation e Channel configurados pelo autor
- Client token e Agent ID da credencial
- Limite de registros (`Max Rows`, `TOP` no SQL)
- Nome de negócio descritivo no canvas

A IA nunca vê a configuração interna do nó. Vê apenas o contrato semântico publicado pelo MCP Server.

### Infraestrutura existente (Camada 4)

Inalterada. Toda execução percorre o caminho já testado e publicado:

```
Nó de consulta
    ↓
shared/n8n — plugClientExecution, validateGuidedSql
    ↓
shared/rest ou shared/socket
    ↓
plug_server (auth, policy, rate limit, replay guard)
    ↓
Agente ERP
    ↓
Banco de dados real
```

## Fluxo de execução

```
Usuário pergunta: "Quais títulos vencidos tem o cliente João?"

1. AI Hub recebe a mensagem
2. AI Hub consulta MCP Server: tools/list
3. MCP Server retorna capabilities disponíveis
4. IA escolhe: consultar_cliente + contas_receber_vencidas
5. IA chama tools/call: consultar_cliente { nomeCliente: "%João%" }
6. MCP Server valida params
7. MCP Server delega ao nó "Consultar Cliente"
8. Nó executa SQL base com :nomeCliente
9. plug_node → plug_server → ERP → retorna CodCliente: 42
10. IA chama tools/call: contas_receber_vencidas { codCliente: 42, limite: 50 }
11. MCP Server valida params
12. MCP Server delega ao nó "Contas a Receber Vencidas"
13. Nó executa SQL base com :codCliente, :limite
14. Resultado volta para a IA
15. IA formula resposta em linguagem natural
```

## Responsabilidades por camada — tabela

| Responsabilidade                   | AI Hub | MCP Server | Nó de consulta | Infraestrutura |
| ---------------------------------- | ------ | ---------- | -------------- | -------------- |
| Comportamento e tom da IA          | X      |            |                |                |
| Regras de uso de ferramentas       | X      |            |                |                |
| Listagem de capabilities           |        | X          |                |                |
| Validação de parâmetros de negócio |        | X          |                |                |
| Filtros obrigatórios               |        | X          | X              |                |
| Auditoria de execução              |        | X          |                |                |
| SQL base e named params            |        |            | X              |                |
| Limite de registros (MAX ROWS)     |        | X          | X              |                |
| Autenticação no hub                |        |            |                | X              |
| Rate limit e quotas                |        |            |                | X              |
| Validação guided SQL               |        |            |                | X              |
| Policy do client token             |        |            |                | X              |
| Replay guard                       |        |            |                | X              |

## Tipos de capability suportados

### V1 — Nó de consulta SQL

Provider: instância de `Plug Database > Resource = SQL > Execute SQL`

Uso: qualquer consulta SELECT ao ERP. Dados de cliente, financeiro, estoque, pedidos.

### V1 — Nó de ação Tools

Provider: instância de `Plug Database > Resource = Tools`

Uso: gerar PDF de boleto, validar CPF/CNPJ, publicar socket event, gerar código de barras.

### V2 — Sub-workflow

Provider: workflow n8n filho executado via Call n8n Workflow ou Execute Workflow.

Uso: capabilities compostas que combinam múltiplos passos (consultar + gerar PDF + enviar WhatsApp).

### V2 — REST externo

Provider: HTTP Request node ou outro nó de integração.

Uso: consultar CEP, abrir chamado em HelpDesk externo, enviar WhatsApp via API.

### V2 — Resource estático (documento)

Provider: conteúdo estático configurado no MCP Server.

Uso: glossário de tabelas ERP, manual de operação, política comercial, tabela CFOP.

### V3 — Consulta livre governada

Provider: `Plug Database > SQL > Execute SQL` em modo avançado com schema parcial.

Uso: queries analíticas sob demanda com validação de tabelas, colunas e limites. Exige validador intermediário antes de executar.

## Contrato de saída do MCP Server para a IA

O que o MCP Server retorna em `tools/call` deve ser consistente entre capabilities. A IA usa esse envelope para interpretar o resultado.

```json
{
  "content": [
    {
      "type": "text",
      "text": "<resultado normalizado — JSON ou texto>"
    }
  ],
  "meta": {
    "capability": "contas_receber_vencidas",
    "rowCount": 50,
    "truncated": true,
    "executionMs": 312,
    "emptyResult": false
  }
}
```

Regras do envelope:

- `content[0].text` contém os dados em JSON string ou mensagem amigável quando zero linhas
- `meta.truncated: true` quando `rowCount === maxRows` — sinaliza à IA que há mais registros não retornados
- `meta.emptyResult: true` quando `__plug.emptyResult` do nó — a IA informa ao usuário que não há registros
- Erros do Plug chegam ao MCP Server como exceção; o MCP converte para `isError: true` com mensagem amigável
- Dados de credencial, tokens e campos internos do Plug nunca aparecem no `content`

A IA usa `meta.truncated` para oferecer ao usuário a opção de refinar o filtro quando o resultado foi cortado.

## Propagação de contexto para auditoria

A identidade do usuário e o contexto da sessão precisam chegar ao log de auditoria do MCP Server mesmo quando a IA não os passa explicitamente como parâmetro de capability.

Fluxo recomendado:

```
AI Hub recebe mensagem com contexto (userId, sessionId, canal)
    ↓
AI Hub injeta contexto como metadata no tool call
    ↓
MCP Server extrai e registra no audit log
    ↓
MCP Server não passa o contexto ao nó Plug (não é parâmetro SQL)
    ↓
Audit log: capability, params, userId, sessionId, timestamp, duração, resultado
```

O `sessionId` permite rastrear todas as chamadas de uma conversa. O `userId` identifica quem solicitou. Ambos são definidos pelo AI Hub, não pela IA.

Na V1, quando o contexto não estiver disponível, o audit log usa `userId: anonymous` e `sessionId: <uuid gerado por chamada>`.

## Onde o MCP Server roda

A regra de arquitetura do repositório proíbe servidores HTTP standalone no `plug_node`. As opções viáveis são:

| Opção                              | Adequação             | Observação                                         |
| ---------------------------------- | --------------------- | -------------------------------------------------- |
| Nó `Plug MCP Server` no pacote n8n | Melhor encaixe        | Workflow hospeda; execução delega para nós filhos  |
| n8n MCP Server Trigger nativo      | Boa para V1           | Protocolo pronto; menos customização de governance |
| Facade no plug_server              | Boa para multi-tenant | Auth e policy já centralizados; mais escala        |

Na V1 a opção recomendada é o **nó `Plug MCP Server`** no pacote, hospedado como parte do workflow. Isso mantém a arquitetura de integração n8n e não exige novo servidor.

## Versão do protocolo MCP

O MCP Server deve declarar a versão do protocolo que implementa. Isso é crítico para compatibilidade com clientes externos na V3.

| Campo                   | Valor                                               |
| ----------------------- | --------------------------------------------------- |
| Versão do protocolo MCP | `2024-11-05` (versão estável atual)                 |
| Transporte V1           | Interno ao n8n (sem stdio/SSE)                      |
| Transporte V3           | stdio para Cursor/Claude Desktop; SSE para apps web |

Na V1, como o MCP Server roda dentro do n8n, a versão é declarada no registry mas não exige negociação de protocolo. A negociação (`initialize` / `initialized`) passa a ser obrigatória quando clientes externos forem suportados na V3.

## Relação com `usableAsTool` existente

O campo `usableAsTool: true` no `Plug Database` continua válido para casos simples (um agente com poucos nós Plug). O MCP Server é a evolução para quando há muitas capabilities, necessidade de governance centralizada ou clientes MCP externos ao n8n.

Os dois modelos podem coexistir:

- Fluxos simples: AI Agent + N instâncias Plug com `usableAsTool`
- Fluxos governados: AI Agent + Plug MCP Server + N nós de capability
