# n8n-nodes-plug-client

Pacote publico do Plug Client para n8n.

## Escopo

- `Validate Context`
- `Execute SQL`
- `Execute Batch`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

## Limitacoes

- pacote `REST-only`
- sem canal `SOCKET`

## Credencial

Campos principais:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`
- URL da API fixa no package: `https://plug-server.se7esistemassinop.com.br/api/v1`

## Saida

- `Aggregated JSON`
- `Raw JSON-RPC`
- toggle `Include Plug Metadata`

## Referencias

- [Documentacao do workspace](../../docs/project-summary.md)
- [Exemplos de workflow](../../docs/workflow-examples.md)
