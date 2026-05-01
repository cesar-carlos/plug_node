# Plug Client n8n Workspace

[![CI](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/cesar-carlos/plug_node/actions/workflows/ci.yml)

Workspace para desenvolvimento do node Plug Client para n8n.

## Objetivo

Entregar uma integracao focada em comandos, onde o usuario final informa apenas:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`
- `Channel = REST | SOCKET`

O node cuida de login, refresh, relay socket, decode de `PayloadFrame`, `gzip` e normalizacao de resposta para JSON.

A URL da API Plug fica fixa no projeto:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Pacotes

- `packages/n8n-nodes-plug-client`
  - pacote publico
  - somente REST
- `packages/n8n-nodes-plug-client-internal`
  - pacote principal
  - REST + SOCKET relay

## Desenvolvimento

Node recomendado para o workspace:

- `22.22.0`

Comandos principais:

```bash
npm ci
npm run verify
```

Comandos uteis:

```bash
npm run format
npm run lint
npm run typecheck
npm test
npm run build
```

## Documentacao

- [Resumo do projeto](./docs/project-summary.md)
- [Arquitetura](./docs/architecture.md)
- [Padroes de comunicacao](./docs/communication-patterns.md)
- [Decisoes de UX](./docs/ux-decisions.md)
- [Estrategia de testes](./docs/testing-strategy.md)
- [Exemplos de workflow](./docs/workflow-examples.md)
- [Processo de release](./docs/release-process.md)
- [Changelog](./CHANGELOG.md)

## Regras do projeto

Leia [AGENTS.md](./AGENTS.md) e depois as regras reais em [`.cursor/rules`](./.cursor/rules).

## Contribuicao

Para contribuir, leia [CONTRIBUTING.md](./CONTRIBUTING.md).

## Seguranca

Leia [SECURITY.md](./SECURITY.md) para orientacoes de reporte e cuidados com credenciais, tokens e logs.
