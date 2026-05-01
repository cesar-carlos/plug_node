# Release Process

## Objetivo

Padronizar como o workspace evolui e como os packages podem ser publicados de forma previsivel.

## Fluxo recomendado

1. Desenvolver a feature ou correcao em branch propria.
2. Rodar `npm run verify` localmente.
3. Abrir PR usando o template do repositorio.
4. Esperar o workflow `CI` passar no GitHub.
5. Atualizar `CHANGELOG.md` se houver mudanca relevante para usuarios ou mantenedores.
6. Versionar o package alvo com o fluxo do `n8n-node release` quando a publicacao for necessaria.

## Escopo de versionamento

- `packages/n8n-nodes-plug-client`
  - candidato a distribuicao publica
  - suporte `REST` apenas
- `packages/n8n-nodes-plug-client-internal`
  - package principal interno
  - suporte `REST` e `SOCKET`

## Checklist de release

- `npm ci`
- `npm run verify`
- confirmar que a documentacao em `docs/` continua coerente
- revisar `CHANGELOG.md`
- validar que os `README.md` dos packages refletem o comportamento atual

## Observacoes

- O workflow de CI inclui um reparo explicito para bindings nativos opcionais no Linux.
- A decisao sobre licenciamento do repositorio deve ser tratada separadamente antes de uma publicacao externa formal.
