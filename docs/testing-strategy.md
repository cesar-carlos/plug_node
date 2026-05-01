# Estrategia de testes

## Objetivo

A estrategia de testes do v1 busca validar os pontos de maior risco tecnico do projeto:

- ciclo de autenticacao
- comportamento REST vs SOCKET
- codec binario do relay
- normalizacao de resposta para items n8n
- integridade do empacotamento n8n

## Tipos de teste implementados

### Unit tests / behavior tests

Cobertura atual:

- renovacao de sessao com retry unico em erro de autenticacao
- reuso de sessao autenticada entre execucoes do runner
- deduplicacao de login concorrente
- falha de refresh token propagada corretamente
- erro HTTP de login por credencial invalida
- erro HTTP de login por conta bloqueada
- erro HTTP de refresh rejeitado
- validacao de resposta malformada de login
- normalizacao de output em `Execute SQL`
- omissao opcional de `__plug`
- output `Chunk Items` para relay socket
- mapeamento de erro HTTP para validacao e retry guidance
- mapeamento de erro RPC para `agent_offline` e `rate_limited`
- encode/decode de `PayloadFrame`
- coleta de chunks no relay socket
- erros `ACCOUNT_BLOCKED` e `AGENT_ACCESS_REVOKED`
- fixture de login e fixture REST bridge para `client_token.getPolicy`
- execucao do node em `Validate Context`
- execucao do node em `Raw JSON-RPC`

Arquivos:

- `tests/public/session.test.ts`
- `tests/public/output.test.ts`
- `tests/public/contracts.test.ts`
- `tests/public/nodeExecution.test.ts`
- `tests/internal/payloadFrameCodec.test.ts`
- `tests/internal/relaySession.test.ts`
- `tests/internal/relayErrors.test.ts`

### E2E tests

Estrutura adicionada:

- `tests/e2e/rest.e2e.test.ts`
- `tests/e2e/socket.e2e.test.ts`
- `tests/e2e/helpers/e2eEnv.ts`
- `tests/e2e/helpers/liveExecuteContext.ts`
- `tests/e2e/vitest.config.mts`

Objetivos:

- validar login real com `.env`
- validar login real diretamente em `loginClient`
- validar refresh token real diretamente em `refreshClientSession`
- validar refresh token adulterado e registrar o shape real de erro
- validar o fluxo real de refresh do `createExecutionSessionRunner`
- validar `Validate Context` em `REST`
- validar `Validate Context` em `SOCKET`
- executar queries SQL reais pelos dois canais
- validar `multi_result` real com dois `SELECT` bem-sucedidos
- validar o comportamento fail-fast de `multi_result` quando um statement falha por autorizacao
- registrar o shape real de erro de autorizacao por recurso negado
- registrar o shape real de erro de SQL invalida
- exercitar o decode real do relay socket ate a saida JSON do node

Comandos:

- `npm run test:e2e`
- `npm run test:e2e:rest`
- `npm run test:e2e:socket`
- `npm run test:coverage`

Observacoes:

- `E2E` nao entra em `npm run verify`
- `.env` fica local e ignorado pelo Git
- `.env.example` documenta o contrato esperado para as credenciais

## Validacoes de pacote

Cada pacote foi validado com:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`

Pacotes validados:

- `packages/n8n-nodes-plug-client`
- `packages/n8n-nodes-plug-client-internal`

## O que esta sendo garantido hoje

### Autenticacao

- login com `email` e `password`
- refresh e reexecucao unica em erro de autenticacao

### Output

- `rows` de SQL geram itens n8n separados no modo padrao

### Relay / socket

- `connection:ready`
- `relay:conversation.start`
- `relay:rpc.request`
- `relay:rpc.response`
- `relay:rpc.stream.pull`
- `relay:rpc.chunk`
- `relay:rpc.complete`

### Build / packaging

- os dois pacotes compilam com `@n8n/node-cli`
- os assets do node sao copiados
- o codigo compartilhado e sincronizado via `scripts/sync-shared.mjs`

## Gaps conhecidos do v1

Ainda nao existem testes automatizados para todos os cenarios desejados no plano original.

Itens recomendados para a proxima etapa:

- ampliar fixtures de contrato com mais exemplos do Plug
- cobertura de `denied_resources` e negacoes de permissao por tabela/view
- testes de operacoes guiadas adicionais com mocks de `IExecuteFunctions`
- cobertura E2E adicional para cenarios de erro do relay em ambiente real

## Criterios de aceite usados nesta entrega

Foram considerados aceitos os seguintes pontos:

- pacote interno entrega UX com quatro campos + escolha de canal
- pacote publico entrega a mesma base de uso, restrita a REST
- documentacao do projeto foi escrita em `docs/`
- lint, typecheck, testes e build passaram nos dois pacotes
