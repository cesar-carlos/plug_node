# Roadmap de Implementação — Plug MCP Hub

## Critério de prioridade

Cada fase entrega valor utilizável de forma independente. A V1 pode ir a produção sem a V2. A V2 não depende da V3.

A ordem reflete risco e complexidade crescente. As capabilities mais simples e seguras ficam na V1; as mais flexíveis e complexas ficam nas fases posteriores.

---

## Proto-V1 — Validação imediata (sem novo código)

**Objetivo:** Validar o modelo de capability nodes e o comportamento da IA antes de construir o Plug MCP Server.

Usar a infraestrutura existente: `usableAsTool: true` no `Plug Database` + AI Agent nativo do n8n.

### Como montar

1. Criar um workflow com AI Agent (n8n nativo)
2. Conectar N instâncias do `Plug Database` como tools, cada uma com:
   - Nome de negócio descritivo no canvas
   - SQL base pré-configurado com named params
   - Descrição semântica (quando usar / não usar) no campo de descrição da tool
3. Configurar system prompt com os blocos definidos em [ai-hub-rules.md](./ai-hub-rules.md)
4. Testar as capabilities piloto descritas em [capability-nodes.md](./capability-nodes.md)

### O que Proto-V1 valida

- Qualidade do semantic contract: a IA escolhe a capability certa?
- Qualidade dos SQL base: os resultados fazem sentido?
- Comportamento da IA com resultado vazio, filtro faltando, agente offline
- Onde o limite de tool calls por turno é necessário
- Quais campos são sensíveis e precisam mascaramento
- Onde o resultado truncado causa confusão para a IA

### Limitações do Proto-V1

- Sem governance centralizada no MCP Server
- Sem audit log por capability
- Sem validação de parâmetros antes de chamar o banco
- Sem sinalização de `truncated: true`
- Funciona apenas dentro do n8n

Proto-V1 é descartável. O aprendizado obtido informa a implementação do Plug MCP Server na V1.

---

## V1 — Fundação (capability nodes + MCP básico)

**Objetivo:** IA usa capacidades de negócio reais via nós Plug, com governança básica e auditoria.

### Componentes

**Nó: Plug MCP Server**

- Registry de capabilities: lista de nós filhos conectados com seus contratos
- Protocolo `tools/list`: retorna capabilities disponíveis com schema de parâmetros
- Protocolo `tools/call`: recebe chamada da IA, valida params, delega ao nó filho, retorna resultado
- Validação de parâmetros: tipo, obrigatoriedade, range de limite
- Recusa com filtro ausente: se a capability exige ao menos um filtro e nenhum foi passado
- Log de auditoria: capability, params, usuário (quando disponível), timestamp, duração, resultado
- Contrato de erro padronizado: mapeia erros do Plug para mensagens amigáveis

**Nó: Plug AI Hub**

- Configuração de system prompt com blocos fixos de identidade, regras e limitações
- Campo de escopo configurável por instância
- Limite de tool calls por turno
- Conexão com o Plug MCP Server como fonte de capabilities

**Capability nodes (providers V1)**

- `Plug Database > Resource = SQL > Execute SQL` com guided SQL
- `Plug Database > Resource = Tools` para ações auxiliares (PDF, eventos, validações)

### Capabilities piloto

Implementar e validar as seguintes capabilities antes de abrir para produção:

| Capability                | Resource | Categoria  |
| ------------------------- | -------- | ---------- |
| Consultar Cliente         | SQL      | CRM        |
| Contas a Receber Vencidas | SQL      | Financeiro |
| Contas a Receber a Vencer | SQL      | Financeiro |
| Saldo em Estoque          | SQL      | Estoque    |
| Consultar Produto         | SQL      | Estoque    |
| Publicar Evento de Status | Tools    | Automação  |
| Validar CPF/CNPJ          | Tools    | Compliance |
| Gerar PDF de Documento    | Tools    | Documentos |

### Critérios de conclusão da V1

- [ ] Plug MCP Server implementado como nó n8n no pacote
- [ ] `tools/list` retorna capabilities com schema correto
- [ ] `tools/call` delega e retorna resultado normalizado
- [ ] Validação de params rejeita antes de chamar o banco
- [ ] Audit log registra toda execução
- [ ] Capabilities piloto funcionais e testadas
- [ ] System prompt template documentado e validado
- [ ] Testado com: zero linhas, permissão negada, param faltando, agente offline
- [ ] Nenhuma capability de administração exposta ao agente
- [ ] Documentação de como criar novos capability nodes publicada

### O que não entra na V1

- Resources estáticos (glossário, manual ERP)
- Capabilities compostas (sub-workflows)
- REST/Webhook externos
- Filtros dinâmicos com whitelist
- Consulta livre ERP
- Clientes MCP externos ao n8n

---

## V2 — Conhecimento e composição

**Objetivo:** IA acessa contexto documental e executa fluxos multi-passo via capabilities compostas.

### Componentes

**Resources no MCP Server**

- `erp://glossario` — tabelas, campos, relacionamentos do ERP para contexto da IA
- `erp://politica-dados` — o que pode e não pode ser retornado por categoria
- `erp://manual-operacao` — procedimentos internos, regras de negócio
- `workflow://capabilities` — catálogo autodescritivo das capabilities disponíveis

Resources são **somente leitura** — a IA consome contexto, não executa.

**Provider: Sub-workflow (capability composta)**

Permite modelar capabilities que executam múltiplos passos internamente.

Exemplos:

- `Análise Financeira do Cliente` → Consultar Cliente + Contas a Receber Vencidas + Contas a Receber a Vencer
- `Enviar Cobrança` → Consultar título + Gerar PDF + Publicar evento + Registrar log
- `Devolução de Mercadoria` → Verificar pedido + Verificar estoque + Registrar devolução

A IA chama uma capability única; o workflow interno orquestra os passos.

**Provider: REST / Webhook externo**

Conecta capabilities a APIs externas sem alterar o contrato MCP.

Exemplos: consultar CEP, abrir ticket em HelpDesk, enviar WhatsApp via API.

**Versionamento de capabilities**

- Cada capability tem versão semântica
- Mudanças breaking exigem nova versão
- Versões anteriores permanecem disponíveis durante período de migração

**Melhoria na descoberta semântica**

- Tags e embeddings por capability para busca por similaridade
- Top-K relevantes retornados no `tools/list` filtrado por contexto
- Reduz contexto enviado à IA quando o catálogo cresce

### Capabilities adicionais na V2

| Capability                      | Provider            | Categoria    |
| ------------------------------- | ------------------- | ------------ |
| Histórico de Compras do Cliente | SQL                 | CRM          |
| Análise Financeira do Cliente   | Sub-workflow        | Financeiro   |
| Consultar Pedido                | SQL                 | Vendas       |
| Posição de Pedido               | SQL                 | Vendas       |
| Enviar Cobrança                 | Sub-workflow        | Automação    |
| Consultar CEP                   | REST externo        | Utilidade    |
| Procedimento de Devolução       | Resource documental | Conhecimento |

---

## V3 — Escala e SQL assistido

**Objetivo:** Suportar centenas de capabilities, permitir consultas analíticas flexíveis e habilitar clientes MCP externos ao n8n.

### Componentes

**Consulta livre governada (Plug SQL assistido)**

Permite que a IA construa consultas dentro de restrições definidas pelo autor:

- Schema parcial: apenas tabelas e colunas permitidas por capability ou token
- Filtros dinâmicos com whitelist: operadores e colunas aprovados
- Validador intermediário antes de `Execute SQL`: rejeita mutações, subqueries pesadas, tabelas fora do escopo
- `TOP` e filtro obrigatório sempre presentes
- Auditoria reforçada: SQL gerado registrado em log
- Timeout configurável por capability

Esse componente é o de maior risco e exige o validador funcionando antes de ir a produção.

**Descoberta automática de nós**

MCP Server detecta nós Plug conectados no canvas e infere a capability a partir de nome, descrição e configuração, sem que o autor precise registrar manualmente.

**Templates de capability**

Biblioteca de capabilities pré-definidas por vertical (varejo, distribuição, serviços) que o autor instancia e parametriza em vez de construir do zero.

Exemplos de templates:

- Template CRM básico: Consultar Cliente, Histórico de Compras
- Template Financeiro básico: Contas a Receber, Contas a Pagar, Fluxo de Caixa
- Template Estoque básico: Saldo, Consultar Produto, Movimentação

**Clientes MCP externos**

- Transporte stdio ou SSE para clientes fora do n8n (Cursor, Claude Desktop, app próprio)
- Autenticação via client token do plug_server
- Mesmo registry e governance da instância n8n

**Marketplace de capabilities**

- Catálogo compartilhado entre clientes Plug
- Capabilities publicadas como pacotes reutilizáveis
- Ratings e validação de governance antes da publicação

---

## Resumo das fases

| Entrega                                 | V1  | V2  | V3  |
| --------------------------------------- | --- | --- | --- |
| Plug MCP Server (nó n8n)                | X   |     |     |
| Plug AI Hub (system prompt + políticas) | X   |     |     |
| Capability nodes SQL + Tools            | X   |     |     |
| Capabilities piloto (8 core)            | X   |     |     |
| Log de auditoria                        | X   |     |     |
| Resources documentais                   |     | X   |     |
| Capabilities compostas (sub-workflow)   |     | X   |     |
| Provider REST externo                   |     | X   |     |
| Versionamento de capabilities           |     | X   |     |
| Descoberta semântica (top-K)            |     | X   |     |
| SQL assistido governado                 |     |     | X   |
| Descoberta automática de nós            |     |     | X   |
| Templates de capability                 |     |     | X   |
| Clientes MCP externos ao n8n            |     |     | X   |
| Marketplace de capabilities             |     |     | X   |

---

## Decisões de produto pendentes

Antes de iniciar a implementação da V1, definir:

| Decisão                                            | Opções                                       | Impacto                       |
| -------------------------------------------------- | -------------------------------------------- | ----------------------------- |
| Onde o MCP Server hospeda o transporte             | Nó n8n (recomendado) / facade no plug_server | Arquitetura, escala           |
| Registro de capabilities: manual ou auto-discovery | Manual na V1 / automático na V3              | UX do criador de fluxo        |
| Um MCP por workflow ou catálogo global             | Por workflow na V1 / global na V3            | Isolamento de clientes        |
| `usableAsTool` direto vs MCP Server                | Coexistem / MCP substitui                    | Migração de fluxos existentes |
| Schema de auditoria                                | Estrutura do log e destino                   | Observabilidade               |

## Relação com o `plug_node` existente

Nenhum contrato existente é quebrado nas fases V1 e V2. As adições são:

- Novo nó `Plug MCP Server` no pacote `n8n-nodes-plug-database`
- Novo nó `Plug AI Hub` ou configuração do AI Agent existente
- Documentação de como criar capability nodes (este planejamento)

Na V3, a consulta livre governada exige um validador de SQL que pode viver em `shared/` como módulo reutilizável, alinhado à organização por responsabilidade do repositório.

Mudanças que afetam comportamento publicado do pacote exigem Changeset e versionamento SemVer conforme a [estratégia de versionamento](../versioning-strategy.md).
