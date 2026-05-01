# Plug Client n8n Node v1

## Objetivo do projeto

O objetivo deste projeto e entregar um node n8n focado em consumo de comandos da API Plug com a menor friccao possivel para o usuario final.

No fluxo v1, quem usa o node precisa informar apenas:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`
- `Channel = REST | SOCKET`

A implementacao interna do node fica responsavel por:

- fazer login no Plug
- manter `accessToken` e `refreshToken`
- renovar sessao quando necessario
- enviar comandos REST para o bridge
- abrir conexao Socket.IO no namespace `/consumers`
- decodificar `PayloadFrame` binario
- tratar `gzip` quando presente
- devolver tudo em JSON normalizado para o n8n

## Experiencia alvo

O projeto foi desenhado para que o usuario pense em "consumir comandos do agente" e nao em "integrar com autenticacao, refresh, relay, compressao e frames".

Principios adotados:

- credencial unica com os quatro campos principais
- selecao explicita de canal
- URL da API Plug fixa no projeto
- formularios guiados para operacoes comuns
- modo avancado para JSON-RPC bruto
- padrao de saida amigavel para n8n
- toggle para incluir ou omitir metadados `__plug`
- mensagens de erro focadas no `user_message` retornado pela API quando disponivel

## Escopo v1

Operacoes implementadas:

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

Comportamentos importantes:

- `Execute SQL` retorna um item n8n por linha por padrao quando existe `rows`
- `Execute Batch` permanece `REST-only`
- `SOCKET` usa apenas o protocolo relay no v1
- nao existe trigger realtime no v1
- nao existe sessao socket persistente entre execucoes

## Fora de escopo no v1

- fluxos de governanca de acesso client/agent
- listagem e administracao de agentes aprovados
- fluxos owner/admin
- trigger realtime persistente
- suporte ao protocolo legado `agents:command`
- armazenamento de `clientToken` no servidor Plug como fonte principal
- assinatura/HMAC obrigatoria de payloads, salvo exigencia futura do ambiente

## Estrutura de entrega

O workspace foi dividido em dois pacotes n8n:

- `packages/n8n-nodes-plug-client`
  - pacote publico
  - somente REST
- `packages/n8n-nodes-plug-client-internal`
  - pacote principal do projeto
  - REST + SOCKET relay

Codigo compartilhado:

- `shared/`
  - contratos
  - autenticacao
  - transporte REST
  - transporte relay/socket
  - normalizacao de output
  - descricao/execucao compartilhada do node

Arquivos de apoio:

- `AGENTS.md`
  - indice para regras do projeto
- `.cursor/rules`
  - fonte real das regras de arquitetura e codificacao

## Lista final de packages

Tooling padronizado no workspace:

- `@changesets/cli@2.31.0`
- `@n8n/node-cli@0.28.0`
- `typescript@5.9.3`
- `eslint@9.39.4`
- `prettier@3.8.3`
- `vitest@4.1.5`
- `@types/node@25.6.0`
- `release-it@20.0.1`

Peer dependency:

- `n8n-workflow`

Runtime adicional do pacote interno:

- `socket.io-client@4.8.3`

Built-ins usados no lugar de pacotes externos:

- `node:crypto`
- `node:zlib`
- `node:buffer`
- `Date`
- `Intl.DateTimeFormat`

Packages evitados no v1:

- `axios`
- `zod`
- `uuid`
- `pako`
- `ws`
- `turbo`
- `lerna`

Packages analisados e descartados por nao combinarem com o escopo atual:

- `morgan`
  - e middleware de log HTTP; este projeto nao expoe servidor HTTP proprio
- `supertest`
  - e voltado a testes de servidores HTTP; nosso teste atual e de modulo/node behavior com `Vitest`
- `jsonwebtoken`
  - so faria sentido se fossemos assinar ou validar JWT localmente; hoje apenas transportamos tokens retornados pela API
- `moment`
  - foi descartado em favor de `Date` e `Intl`
- `cors`
  - so faz sentido em servidor HTTP/browser boundary
- `helmet`
  - so faz sentido para cabecalhos de seguranca de servidor HTTP
- `multer`
  - so faz sentido para upload `multipart/form-data`
- `dotenv`
  - o node depende de credenciais do n8n, nao de `.env` em runtime
- `uuid`
  - substituido por `crypto.randomUUID()`

## Qualidade e automacao

Comandos de qualidade do workspace:

- `npm run format:check`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run verify`

Automacao adicionada:

- workflow CI em `.github/workflows/ci.yml`
- workflow de versionamento em `.github/workflows/release.yml`
- `.nvmrc` com `22.22.0`
- `engines.node` no root do workspace
- `Changesets` com grupo fixo para os dois packages

## Estado atual da implementacao

Na data desta documentacao, o projeto foi validado com:

- `lint`
- `typecheck`
- `test`
- `build`

Nos dois pacotes.

## Observacao de ambiente

Durante a montagem local, o ecossistema do `@n8n/node-cli` puxou dependencia nativa transitiva que pode ser sensivel a versoes muito novas do Node.js.

Recomendacao pratica para a equipe:

- preferir uma versao Node LTS suportada pelo stack n8n ao preparar o ambiente
- se houver problema de install em ambiente experimental, validar primeiro com a LTS antes de assumir defeito do projeto
