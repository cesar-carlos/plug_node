# Contratos de erro e autorizacao

## Objetivo

Este documento registra os contratos de erro, autorizacao e comportamento SQL
que o `plug_node` consome hoje do `plug_server` e do `plug_agente`.

Ele existe para deixar claro:

- quais padroes de resposta orientam o tratamento de erro do node
- quais regras de autorizacao por `client_token` afetam `sql.execute`
- quais limitacoes de `SELECT`, paginacao e introspecao precisamos respeitar
- quais pontos estao em uso real no projeto, para facilitar manutencao futura

## Fontes utilizadas

### `plug_server`

- `D:\Developer\plug_database\plug_server\docs\api_rest_bridge.md`
- `D:\Developer\plug_database\plug_server\docs\client_agent_business_rules.md`
- `D:\Developer\plug_database\plug_server\docs\socket_client_sdk.md`
- `D:\Developer\plug_database\plug_server\docs\socket_relay_protocol.md`
- `D:\Developer\plug_database\plug_server\docs\user_status.md`

### `plug_agente`

- `D:\Developer\plug_database\plug_agente\docs\communication\socket_communication_standard.md`
- `D:\Developer\plug_database\plug_agente\docs\communication\openrpc.json`

## Metodos em uso no node

O node v1 trabalha somente com este subconjunto do contrato:

- `sql.execute`
- `sql.executeBatch`
- `sql.cancel`
- `agent.getProfile`
- `client_token.getPolicy`
- `rpc.discover`

Observacoes:

- `rpc.discover` e usado para ler o contrato OpenRPC publicado pelo agente
- o `openrpc.json` atual ja expoe `agent.getHealth`, mas esse metodo nao entra no
  escopo do node v1
- o node injeta `client_token` automaticamente nos metodos que exigem ou aceitam
  o token

## Autorizacao por `client_token`

O contrato do `plug_agente` documenta que a autorizacao por token de cliente
fica ativa por padrao quando `enableClientTokenAuthorization = true`.

Pontos utilizados pelo node:

- o token pode chegar como:
  - `params.client_token`
  - `params.clientToken`
  - `params.auth`
- o node usa `params.client_token` como formato canonico
- o token e normalizado pelo agente
- a politica resolvida e consultada no armazenamento local do agente
- `deny` tem precedencia sobre `allow`

Consequencias praticas para o node:

- token ausente ou vazio pode retornar `-32001`
  - `reason: missing_client_token`
- token revogado ou nao autorizado pode retornar `-32002`
  - `reason: unauthorized`
  - `odbc_reason` pode detalhar `token_revoked` ou `missing_permission`
- negacoes de autorizacao em SQL podem incluir:
  - `error.data.resource`
  - `error.data.denied_resources`

O node usa esses sinais para:

- priorizar mensagem amigavel ao usuario
- orientar revisao/renovacao do `Client Token`
- preservar detalhes tecnicos em metadados

## Regras de `SELECT`, paginacao e execucao SQL

Para `sql.execute`, o `plug_agente` documenta restricoes importantes que o node
deve respeitar e explicar:

- `options.page` e `options.page_size`
  - so valem para `SELECT` e `WITH`
  - devem ser enviados juntos
  - exigem `ORDER BY` explicito
- `options.cursor`
  - nao pode ser combinado com `page` ou `page_size`
- `options.execution_mode: "preserve"`
  - nao pode ser combinado com `page`, `page_size` ou `cursor`
- `options.multi_result`
  - nao pode ser combinado com paginacao
  - nao pode ser combinado com `params` nomeados
- o runtime atual do agente suporta ate `5` parametros nomeados por comando

Observacao importante:

- a SQL final reescrita para paginacao depende do dialeto do banco
- o node nao deve assumir o SQL literal final
- o node so envia `sql` + `options`

## Estrutura obrigatoria de erro do agente

O `plug_agente` define que toda resposta de erro RPC deve carregar `error.data`
com este contrato:

- `reason`
- `category`
- `retryable`
- `user_message`
- `technical_message`
- `correlation_id`
- `timestamp`

Esse e o principal contrato usado pelo node para transformar erro tecnico em
mensagem operacional.

Regras adotadas no `plug_node`:

1. mostrar `user_message` quando existir
2. mapear `reason`, `code` e `status` para um texto mais claro quando o agente
   nao trouxer uma mensagem suficientemente boa
3. preservar `correlation_id` para suporte
4. nunca usar `technical_message` como mensagem principal para a pessoa que esta
   montando o workflow

## Catalogo de erro SQL e transporte utilizado

Os codigos e `reason` abaixo sao os mais importantes para o node:

### Autenticacao e autorizacao

- `-32001`
  - `authentication_failed`
  - `missing_client_token`
  - `invalid_signature`
- `-32002`
  - `unauthorized`
  - submotivos possiveis em `odbc_reason`, como `token_revoked` e `missing_permission`

### Transporte e rate limit

- `-32008`
  - `timeout`
- `-32009`
  - `invalid_payload`
- `-32010`
  - `decoding_failed`
- `-32011`
  - `compression_failed`
- `-32012`
  - `network_error`
- `-32013`
  - `rate_limited`

### SQL e banco

- `-32101`
  - `sql_validation_failed`
- `-32102`
  - `sql_execution_failed`
- `-32103`
  - `transaction_failed`
- `-32104`
  - `connection_pool_exhausted`
- `-32105`
  - `result_too_large`
- `-32106`
  - `database_connection_failed`
- `-32107`
  - `query_timeout`
- `-32108`
  - `invalid_database_config`
- `-32109`
  - `execution_not_found`
- `-32110`
  - `execution_cancelled`

## Semantica REST do `plug_server`

O `plug_server` introduz uma camada importante: o proxy HTTP pode devolver
sucesso de transporte com erro de negocio dentro do payload JSON-RPC.

Pontos registrados:

- `400`
  - body invalido ou falha de schema
- `401`
  - token ausente/invalido
- `403`
  - conta bloqueada ou operacao nao permitida
- `404`
  - agente desconhecido no hub
- `429`
  - rate limit HTTP
- `503`
  - timeout, overload, fila saturada ou indisponibilidade temporaria
- `200` com erro JSON-RPC dentro de `response`
  - proxy funcionou, mas o agente devolveu erro de negocio/transporte

Caso especial importante:

- `agent_offline`
  - para agente conhecido em memoria, mas sem socket ativo
  - o REST pode devolver `200`
  - o erro real vem em `response.item.error`
  - `reason` comum: `agent_disconnected_at_dispatch`

Outro ponto importante:

- quando o agente devolve `-32013` com `retry_after_ms` ou `reset_at`, o
  `plug_server` pode propagar `Retry-After` no HTTP

O node usa isso para:

- nao confundir sucesso do proxy com sucesso da consulta
- preservar `Retry-After` / `retry_after_ms`
- tratar `agent_offline` como erro operacional claro

## Contrato de refresh do `plug_server`

O endpoint `POST /client-auth/refresh` foi validado por sonda E2E no ambiente
real deste projeto.

Comportamento observado:

- o refresh retorna um novo par de tokens
  - `accessToken`
  - `refreshToken`
- o body pode trazer:
  - `success`
  - `token`
- o body de refresh nao precisa repetir `client`

Decisao implementada no node:

- o projeto trata o refresh como um contrato proprio, separado do login
- quando o refresh nao traz `client`, o node preserva o profile do ultimo login
  bem-sucedido em memoria
- isso evita falha de validacao local e respeita o contrato real observado da
  API

## Semantica SOCKET do `plug_server`

No relay `/consumers`, o node depende destes pontos:

- handshake `connection:ready`
- `relay:conversation.start`
- `relay:rpc.request`
- `relay:rpc.accepted`
- `relay:rpc.response`
- `relay:rpc.chunk`
- `relay:rpc.complete`
- `relay:rpc.stream.pull`

Erros operacionais importantes:

- `ACCOUNT_BLOCKED`
  - conta `User` ou `Client` bloqueada
- `AGENT_ACCESS_REVOKED`
  - acesso `Client -> Agent` revogado
- `VALIDATION_ERROR`
  - payload relay invalido

O node traduz esses eventos para mensagens operacionais porque eles nao sao
falhas de SQL em si, mas impactam diretamente quem esta configurando a execucao.

## OpenRPC e descoberta

O `plug_agente` publica um documento OpenRPC em:

- `D:\Developer\plug_database\plug_agente\docs\communication\openrpc.json`

O node usa esse contrato como fonte de verdade para:

- confirmar metodos expostos
- entender a versao atual do profile publicado
- orientar a operacao `rpc.discover`

Pontos que estamos consumindo hoje:

- `sql.execute`
- `sql.executeBatch`
- `sql.cancel`
- `agent.getProfile`
- `client_token.getPolicy`
- `rpc.discover`

Ponto explicitamente fora do escopo do node v1:

- `agent.getHealth`

## Decisoes de documentacao e implementacao

Com base nesses contratos, o `plug_node` assume oficialmente:

- `client_token` e obrigatorio para os fluxos SQL e de policy usados pelo node
- erros de SQL/autorizacao devem ser interpretados primeiro por `reason` e
  `user_message`
- erros REST do proxy e erros RPC do agente precisam de tratamento diferente
- `denied_resources` e um detalhe importante para futura melhoria de UX, mas
  por enquanto ele e preservado em `details`, nao exibido como texto principal
- `technical_message` e mantido para suporte, nao para a mensagem principal do
  usuario
- `correlation_id` deve permanecer visivel nos metadados do erro

## Impacto direto no node

Os contratos acima orientam o comportamento atual do projeto em:

- [shared/auth/session.ts](/D:/Developer/plug_database/plug_node/shared/auth/session.ts)
- [shared/output/rpcNormalization.ts](/D:/Developer/plug_database/plug_node/shared/output/rpcNormalization.ts)
- [shared/socket/relaySession.ts](/D:/Developer/plug_database/plug_node/shared/socket/relaySession.ts)
- [shared/n8n/plugClientExecution.ts](/D:/Developer/plug_database/plug_node/shared/n8n/plugClientExecution.ts)

E os testes relacionados em:

- [tests/public/session.test.ts](/D:/Developer/plug_database/plug_node/tests/public/session.test.ts)
- [tests/public/rpcNormalization.test.ts](/D:/Developer/plug_database/plug_node/tests/public/rpcNormalization.test.ts)
- [tests/internal/relayErrors.test.ts](/D:/Developer/plug_database/plug_node/tests/internal/relayErrors.test.ts)

## Sondas E2E negativas registradas

Para inspecionar o comportamento real do ambiente Plug configurado neste
projeto, os E2E usam hoje duas consultas negativas em `Raw JSON-RPC`:

- autorizacao negada
  - `SELECT * FROM Empresa`
  - retorno esperado: `-32002`, `reason: unauthorized`, `category: auth`,
    `denied_resources: ["empresa"]`
- SQL invalida
  - `SELECT FROM Cliente`
  - retorno esperado: `-32101`, `reason: sql_validation_failed`,
    `category: sql`

Essas consultas ficam parametrizadas por `.env`:

- `PLUG_E2E_SQL_QUERY_UNAUTHORIZED`
- `PLUG_E2E_SQL_QUERY_INVALID`

## Sondas E2E de multi_result registradas

O projeto tambem registra o comportamento real de `sql.execute` com
`options.multi_result: true` nos dois canais suportados.

Cenarios cobertos hoje:

- dois `SELECT` bem-sucedidos
  - query default: `SELECT * FROM Cliente; SELECT * FROM Marca`
  - retorno observado: `response.item.success = true`, `result.multi_result = true`,
    `result.result_set_count = 2`, `result.item_count = 2`, com `result.result_sets`
    e `result.items`
- um `SELECT` bem-sucedido + um `SELECT` negado por autorizacao
  - query default: `SELECT * FROM Cliente; SELECT * FROM Empresa`
  - retorno observado: falha global da chamada inteira
  - nao ha resultado parcial exposto no payload final
  - erro observado: `-32002`, `reason: unauthorized`, `category: auth`,
    `denied_resources: ["empresa"]`

Essas consultas ficam parametrizadas por `.env`:

- `PLUG_E2E_SQL_QUERY_MULTI_RESULT_SUCCESS`
- `PLUG_E2E_SQL_QUERY_MULTI_RESULT_MIXED`

## Sondas E2E de autenticacao registradas

O projeto tambem registra o comportamento real de autenticacao e refresh.

Cenarios cobertos hoje:

- login bem-sucedido com `User (email)` + `Password`
- refresh bem-sucedido com o `refreshToken` retornado pelo login
- refresh com token adulterado
  - retorno esperado: erro HTTP `401`
  - o node converte para mensagem amigavel de sessao expirada
  - o erro tecnico original continua preservado nos metadados
