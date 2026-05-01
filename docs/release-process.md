# Release Process

## Objetivo

Padronizar como o workspace evolui e como os packages podem ser publicados de forma previsivel.

## Fluxo recomendado

1. Desenvolver a feature ou correcao em branch propria.
2. Rodar `npm run verify` localmente.
3. Adicionar um changeset com `npm run changeset` quando a mudanca afetar comportamento de package.
4. Abrir PR usando o template do repositorio.
5. Esperar o workflow `CI` passar no GitHub.
6. Deixar o workflow `Release Control` criar ou atualizar a PR de versionamento.
7. Mesclar a PR de versionamento quando a release estiver pronta.

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
- `npm run changeset:status`
- confirmar que a documentacao em `docs/` continua coerente
- revisar `CHANGELOG.md`
- validar que os `README.md` dos packages refletem o comportamento atual

## Observacoes

- O workflow de CI inclui um reparo explicito para bindings nativos opcionais no Linux.
- O controle de versionamento usa `Changesets` com grupo fixo para manter os dois packages na mesma versao visivel.
- A decisao sobre licenciamento do repositorio deve ser tratada separadamente antes de uma publicacao externa formal.
