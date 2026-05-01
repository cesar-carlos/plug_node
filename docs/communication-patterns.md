# Padroes de comunicacao

## Visao geral

O node trabalha com dois canais de comunicacao:

- `REST`
- `SOCKET`

Nos dois casos, a interface para quem usa o node no n8n continua a mesma. O que muda e o transporte interno.

## Credenciais e autenticacao

A credencial usa:

- `User (email)`
- `Password`
- `Agent ID`
- `Client Token`

Regras adotadas:

- `user` mapeia para o campo `email` do login Plug
- `agentId` e `clientToken` sao a unica fonte de verdade no v1
- a URL da API Plug fica fixa no projeto em `https://plug-server.se7esistemassinop.com.br/api/v1`
- o teste de credencial valida apenas login
- a operacao `Validate Context` faz a verificacao end-to-end

## Fluxo REST

### Login

O node faz:

- `POST /client-auth/login`

Com:

```json
{
  "email": "user@example.com",
  "password": "secret"
}
```

O resultado alimenta:

- `accessToken`
- `refreshToken`

### Refresh

Quando um erro de autenticacao elegivel acontece, o node:

1. tenta `POST /client-auth/refresh`
2. atualiza a sessao em memoria
3. reexecuta a chamada uma unica vez

### Execucao de comando

O canal REST usa:

- `POST /agents/commands`

O node injeta automaticamente:

- `api_version`
- `client_token` para metodos suportados
- `Authorization: Bearer <accessToken>`

## Fluxo SOCKET relay

### Namespace

O canal socket usa:

- namespace `/consumers`

Com autenticacao Socket.IO por:

- `auth.token = accessToken`

### Ciclo da execucao

1. login via REST
2. conexao Socket.IO
3. espera `connection:ready`
4. envia `relay:conversation.start`
5. recebe `relay:conversation.started`
6. envia `relay:rpc.request`
7. recebe `relay:rpc.accepted`
8. coleta:
   - `relay:rpc.response`
   - `relay:rpc.chunk`
   - `relay:rpc.complete`
9. quando necessario, envia `relay:rpc.stream.pull`
10. encerra a conversa
11. desconecta o socket

O socket no v1 e sempre por execucao. Nao existe conexao persistente entre runs do workflow.

## `PayloadFrame`

O relay trabalha com frames binarios no formato `PayloadFrame`.

O projeto implementa:

- decode de envelope
- encode para requests
- suporte a `cmp: none | gzip`
- validacao de tamanho maximo
- protecao basica contra inflation ratio exagerado

O objetivo e expor JSON ao usuario do node e esconder o formato binario.

## Compressao e assinatura

Decisoes adotadas no v1:

- `gzip` esta em escopo e foi implementado
- assinatura/HMAC nao foi tornada obrigatoria no codigo v1
- se um ambiente futuro exigir assinatura obrigatoria, isso deve entrar como extensao controlada da credencial e do codec

## Normalizacao de resposta

O node normaliza respostas REST e SOCKET para um formato unico de transporte antes de converter para items n8n.

Saidas:

- `Aggregated JSON`
  - modo padrao
  - quando ha `rows`, gera um item por linha
- `Chunk Items`
  - usado no pacote interno para cenarios de stream por socket
- `Raw JSON-RPC`
  - diagnostico e cenarios avancados

Opcao adicional:

- `Include Plug Metadata`
  - quando ligada, adiciona `__plug` na saida
  - quando desligada, devolve payload mais limpo

## Tratamento de erros

Prioridades de exibicao:

1. `error.data.user_message`
2. mensagem principal do erro Plug
3. fallback generico

Metadados preservados quando disponiveis:

- `code`
- `statusCode`
- `correlation_id`
- `retryable`
- `Retry-After`

`technical_message` nao deve ser a mensagem principal para o usuario do node.

## Logs tecnicos do node

O projeto usa logging interno para troubleshooting:

- baseado em `LoggerProxy` do `n8n-workflow`
- somente metadados seguros
- foco em login, refresh, transporte REST e relay socket
