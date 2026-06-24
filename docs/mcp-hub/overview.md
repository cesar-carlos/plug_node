# Visão Geral — Plug MCP Hub

## Problema

O `Plug Database` expõe uma superfície técnica ampla: Resource SQL, Client Access, User Access, Tools, dezenas de operações, campos de configuração e modos avançados. Quando esse nó é conectado diretamente a um agente de IA, a IA recebe complexidade técnica que ela não precisa gerenciar.

Para a pergunta "quais clientes têm títulos vencidos?", a IA precisaria:

- Saber que a tabela relevante é `TituloReceber` com join em `Cliente`
- Montar SQL parametrizado corretamente
- Escolher Resource, Operation, Channel e outras opções do nó
- Respeitar a política do client token do hub

Esse nível de conhecimento técnico não deveria ser responsabilidade da IA. Ela deveria conhecer apenas **capacidades de negócio**.

O segundo problema é escala: com 50 ou 100 consultas úteis do ERP, conectar cada nó manualmente ao agente e manter descrições individuais não é sustentável.

## Objetivo

Permitir que quem constrói o fluxo configure consultas e ações uma vez e o sistema exponha essas capacidades para a IA de forma estruturada, segura e governada.

A IA não conhece SQL, JSON-RPC, tabelas ou operações. Ela conhece **capacidades**:

- Consultar Cliente
- Consultar Contas a Receber
- Consultar Estoque
- Publicar Evento de Cobrança
- Gerar Boleto PDF

Cada capacidade é implementada por um nó Plug pré-configurado. A IA escolhe a capacidade certa, preenche os parâmetros de negócio e o sistema executa.

## Visão

```
Usuário faz uma pergunta em linguagem natural
          ↓
     IA recebe catálogo de capacidades via MCP
          ↓
     IA escolhe a capacidade certa
          ↓
     MCP Hub delega para o nó Plug correto
          ↓
     Nó Plug executa SQL/Tool/Evento no hub
          ↓
     Resultado normalizado volta para a IA
          ↓
     IA responde ao usuário com dados reais
```

A IA nunca escreve SQL. Nunca escolhe tabelas. Nunca altera configurações do nó.

## Conceitos principais

### Capability

Uma capacidade de negócio que a IA sabe usar. Tem nome, descrição semântica (quando usar, quando não usar), parâmetros de negócio e um provider que executa.

Exemplos: `Consultar Cliente`, `Contas a Receber Vencidas`, `Saldo em Estoque`, `Enviar Cobrança`.

### Provider

A implementação técnica da capability. No contexto do Plug, o provider é sempre uma instância de `Plug Database` (ou outro nó) pré-configurada com SQL base, operação, credenciais e limites.

A IA não interage com o provider diretamente.

### SQL Base

O SQL fixo definido pelo autor do fluxo no nó de consulta. Contém tabelas, joins, ordenação e filtros estruturais. A IA não altera o SQL base.

A IA só preenche os **parâmetros nomeados** (`:codCliente`, `:limite`, `:dataInicio`) que o autor expôs intencionalmente.

### Semantic Contract

A descrição que a IA lê para entender o que a capability faz. Inclui objetivo, quando usar, quando não usar e os parâmetros disponíveis.

### Governance Contract

As regras que o sistema aplica independentemente da IA: limite máximo de registros, filtros obrigatórios, colunas proibidas, tabelas permitidas pelo client token, validação guided SQL.

## O que o MCP Hub não é

- Não é um substituto para o `Plug Database` — é a camada acima dele
- Não é um servidor HTTP standalone — hospeda-se como nó n8n ou via plug_server
- Não dá à IA liberdade para escrever SQL arbitrário
- Não expõe operações de administração (Client Access, User Access) como tools de agente
- Não gerencia autenticação — isso continua no plug_server e nos nós existentes
