# Decisoes de UX

## Objetivo da UX

A UX do node foi desenhada para reduzir ao maximo a carga cognitiva de quem esta montando um workflow no n8n.

A pergunta central foi:

"Como fazer o usuario pensar so no comando que quer executar?"

## Credencial unica

Foi escolhida uma credencial unica com:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

Motivo:

- elimina lookup extra de agente
- elimina dependencia de token salvo no servidor Plug
- deixa o contexto do node explicito e portavel
- remove configuracao desnecessaria para o utilizador final

A URL da API foi fixada no projeto:

- `https://plug-server.se7esistemassinop.com.br/api/v1`

## Canal explicito

No pacote interno, o usuario escolhe:

- `REST`
- `SOCKET`

Motivo:

- a API possui dois padroes de comunicacao reais
- a escolha precisa ser visivel para quem modela o workflow
- a diferenca de transporte nao deve exigir nodes diferentes no v1

No pacote publico:

- o canal e implicitamente REST

## Guided mode + Advanced mode

Foi adotado um modelo duplo:

- `Guided`
  - melhor para quem quer produtividade e baixa friccao
- `Advanced`
  - melhor para quem conhece o contrato JSON-RPC e quer controle total

Motivo:

- o node atende usuarios com niveis diferentes de familiaridade
- evita obrigar todo mundo a escrever payload bruto

## Restricoes visiveis na UI

A UI foi feita para refletir o que o backend do node realmente suporta.

Exemplos:

- `Execute Batch` continua REST-only
- `Channel` aparece apenas no pacote interno
- `Input Mode` nao aparece em `Validate Context`
- opcoes avancadas ficam agrupadas e escondidas por padrao

Motivo:

- reduzir erro de configuracao
- evitar prometer comportamentos que o transporte nao suporta

## Padrao de output

Decisao principal:

- quando `Execute SQL` retorna `rows`, o default e um item por linha

Motivo:

- esse formato combina melhor com o modelo de dados do n8n
- facilita filtros, merges, loops e persistencia em nodes seguintes

Modos adicionais:

- `Raw JSON-RPC`
- `Chunk Items` no pacote interno

Opcao adicional:

- `Include Plug Metadata`
  - ligada por padrao
  - pode ser desligada quando a pessoa quer payload mais limpo

## Decisao sobre `Validate Context`

O teste de credencial valida apenas login.

A validacao real do contexto ficou em uma operacao dedicada:

- `Validate Context`

Motivo:

- o teste de credencial deve ser leve
- a validacao completa precisa checar login, `agentId`, `clientToken` e transporte

## Decisao sobre mensagens de erro

O node prioriza mensagens que ajudem a pessoa que esta configurando o workflow.

Regras:

- priorizar `user_message`
- manter detalhes tecnicos em metadados
- preservar `correlation_id` quando existir
- sugerir retry apenas quando o contrato indicar isso

## Idioma da interface

A interface publicada do node foi mantida em ingles:

- labels
- descriptions
- mensagens de erro principais

Motivo:

- melhor compatibilidade com ecossistema n8n
- alinhamento com requisitos de publicacao e manutencao do pacote

Os documentos internos do projeto podem continuar em portugues quando isso melhorar a comunicacao da equipe.
