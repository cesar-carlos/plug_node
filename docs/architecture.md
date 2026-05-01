# Arquitetura

## Visao geral

O projeto usa um monorepo npm workspace para manter duas distribuicoes do mesmo node Plug:

- uma distribuicao publica, enxuta, somente REST
- uma distribuicao interna, completa, com REST + SOCKET relay

Isso permite reaproveitar quase toda a logica e, ao mesmo tempo, respeitar diferencas de publicacao e dependencias de runtime.

## Layout do workspace

```text
plug_node/
|-- AGENTS.md
|-- .cursor/rules/
|-- docs/
|-- packages/
|   |-- n8n-nodes-plug-client/
|   `-- n8n-nodes-plug-client-internal/
|-- scripts/
|   `-- sync-shared.mjs
|-- shared/
`-- tests/
```

## Responsabilidade de cada area

### `packages/n8n-nodes-plug-client`

Responsabilidade:

- empacotar o node publico
- expor a mesma UX base do projeto
- restringir o canal a REST
- nao depender de `socket.io-client`

Conteudo principal:

- `credentials/PlugClientApi.credentials.ts`
- `nodes/PlugClient/PlugClient.node.ts`

### `packages/n8n-nodes-plug-client-internal`

Responsabilidade:

- empacotar o node principal do projeto
- suportar `Channel = REST | SOCKET`
- integrar `socket.io-client`
- executar relay por `/consumers`

Conteudo principal:

- `credentials/PlugClientApi.credentials.ts`
- `nodes/PlugClient/PlugClient.node.ts`
- `nodes/PlugClient/socketRelayExecutor.ts`

### `shared/`

Responsabilidade:

- concentrar toda a logica compartilhada de dominio tecnico do node
- evitar duplicacao entre o pacote publico e o pacote interno

Subareas:

- `shared/auth`
  - login
  - refresh
  - retry unico em expiracao de autenticacao
- `shared/contracts`
  - tipos Plug
  - envelopes JSON-RPC
  - erros
  - `PayloadFrame`
- `shared/rest`
  - execucao via bridge REST
- `shared/socket`
  - codec do `PayloadFrame`
  - sessao relay
- `shared/output`
  - normalizacao de resposta
  - transformacao para items do n8n
- `shared/logging`
  - logger seguro para troubleshooting
- `shared/n8n`
  - descricao do node
  - execucao compartilhada do node
- `shared/utils`
  - parsing JSON
  - derivacao de URL

### `scripts/sync-shared.mjs`

Responsabilidade:

- copiar `shared/` para `generated/shared` dentro de cada pacote antes de build, lint e test
- permitir que cada pacote seja compilado no formato esperado pelo `@n8n/node-cli`
- excluir `shared/socket` do pacote publico, porque ele e REST-only

## Fluxo interno de execucao

1. O node le a credencial `plugClientApi`.
2. O executor compartilhado monta um comando guiado ou avancado.
3. O modulo de sessao faz login em `/client-auth/login`.
4. Se o canal for REST:
   - chama `/agents/commands`
5. Se o canal for SOCKET:
   - abre Socket.IO em `/consumers`
   - inicia relay conversation
   - envia `relay:rpc.request`
   - coleta `response`, `chunk` e `complete`
6. A resposta passa pela normalizacao.
7. O node devolve items n8n.

## Observabilidade local

O workspace ganhou um logger interno pequeno e seguro para debugging:

- eventos com metadados seguros
- sem senha, token ou `clientToken`
- integrado ao `LoggerProxy` do `n8n-workflow`

## Motivo da divergencia entre os pacotes

Os dois pacotes divergem por razoes praticas:

- o pacote interno precisa de `socket.io-client`
- o pacote publico deve permanecer mais simples e previsivel
- o pacote publico nao deve oferecer opcoes de UI que nao consegue executar

Mesmo com isso, a experiencia de uso e a base tecnica continuam alinhadas.

## Governanca de regras

O arquivo `AGENTS.md` existe apenas como indice.

A fonte real das regras deste repositório esta em:

- `D:\Developer\plug_database\plug_node\.cursor\rules`

As regras copiadas do projeto anterior foram reduzidas ao que faz sentido para este workspace n8n. Regras antigas voltadas para backend Express e servidor websocket dedicado foram removidas.
