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
- normalizacao de output em `Execute SQL`
- omissao opcional de `__plug`
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
- testes de `Chunk Items`
- testes de operacoes guiadas adicionais com mocks de `IExecuteFunctions`

## Criterios de aceite usados nesta entrega

Foram considerados aceitos os seguintes pontos:

- pacote interno entrega UX com quatro campos + escolha de canal
- pacote publico entrega a mesma base de uso, restrita a REST
- documentacao do projeto foi escrita em `docs/`
- lint, typecheck, testes e build passaram nos dois pacotes
