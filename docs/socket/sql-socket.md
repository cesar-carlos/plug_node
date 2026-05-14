# SQL Via Socket

`Plug Database` executa comandos SQL via Socket quando:

- `Resource = SQL`
- `Channel = Socket`
- a operação selecionada é compatível com Socket

O node autentica por REST, abre uma conexão Socket.IO no namespace `/consumers`, aguarda `connection:ready` e envia o comando pelo evento `agents:command`.

## Operações Compatíveis

Na versão 1 do node, Socket está disponível para:

- `Validate Context`
- `Execute SQL`
- `Cancel SQL`
- `Discover RPC`
- `Get Agent Profile`
- `Get Client Token Policy`

Na versão 2, `Execute Batch` também pode usar Socket quando o servidor suporta `agents:command`.

## Recursos fora deste guia

`Channel = Socket` aplica-se apenas a **`Resource = SQL`**. Operações em **Client Access**, **User Access** e **Tools** usam REST (ou fluxos Socket próprios, como _Publish_ / _Wait_ / trigger), não o canal SQL descrito aqui.

Lista canónica de operações do pacote: [README do pacote `n8n-nodes-plug-database`](../../packages/n8n-nodes-plug-database/README.md#supported-operations).

## Fluxo

```mermaid
sequenceDiagram
  participant N as n8n Plug Database
  participant A as Plug Auth REST
  participant S as Plug Socket /consumers
  participant G as Agent

  N->>A: POST /client-auth/login
  A-->>N: accessToken
  N->>S: Socket.IO connect(token)
  S-->>N: connection:ready PayloadFrame
  N->>S: agents:command { protocolVersion, requestId, clientRequestId, command }
  S->>G: encaminha comando
  G-->>S: resposta ou stream
  S-->>N: agents:command_response
  S-->>N: agents:command_stream_chunk
  S-->>N: agents:command_stream_complete
  N->>S: disconnect
```

## Correlação de comando

Cada `agents:command` enviado pelo node inclui um `requestId` no envelope. Para comandos únicos com `command.id` preenchido, o node usa `String(command.id)` como `requestId`; para notificações, probes e batch, o node gera um UUID local. `clientRequestId` é enviado com o mesmo valor para facilitar compatibilidade durante a transição.

O runtime só aceita `agents:command_response`, `agents:command_stream_chunk`, `agents:command_stream_complete` e `agents:stream_pull_response` que correspondem ao `requestId` e ao `streamId` ativos. Respostas atrasadas ou pertencentes a outra execução são ignoradas.

Para comando único, se um servidor antigo não ecoar a correlação esperada, o node pode cair para o fluxo legado de relay. Para `Execute Batch`, o servidor precisa responder com `requestId` correlacionado no transporte `agents:command`; caso contrário, use REST ou atualize o servidor.

## Contrato mínimo do servidor

Para compatibilidade com `agents:command`, o servidor deve cumprir estes pontos:

| Evento                           | Requisito                                                                                                                                                              |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agents:command`                 | Receber envelope com `protocolVersion`, `requestId`, `clientRequestId`, `agentId`, `command`, `timeoutMs` e `payloadFrameCompression`.                                 |
| `agents:command_response`        | Ecoar `requestId` no sucesso; em stream, também enviar `streamId`. Falhas devem incluir `error.code` e `error.message`, e podem incluir `requestId` quando disponível. |
| `agents:stream_pull`             | Receber `requestId`, `streamId` e `windowSize`.                                                                                                                        |
| `agents:stream_pull_response`    | Ecoar `requestId`, `streamId` e `windowSize` positivo no sucesso.                                                                                                      |
| `agents:command_stream_chunk`    | Enviar `request_id` e `stream_id` do stream ativo.                                                                                                                     |
| `agents:command_stream_complete` | Enviar `request_id`, `stream_id` e `terminal_status`.                                                                                                                  |
| `connect_error` / `app:error`    | Usar códigos estáveis como `TOKEN_EXPIRED`, `INVALID_TOKEN`, `ACCOUNT_BLOCKED` e `AGENT_ACCESS_REVOKED` para permitir reconnect ou encerramento correto.               |

O node ignora mensagens que não batem com a correlação ativa. Isso protege execuções concorrentes e respostas atrasadas, mas exige que batch e stream usem `requestId`/`streamId` corretamente.

## PayloadFrame

`connection:ready` e o tráfego que usa o codec partilhado passam por `PayloadFrame` (descompactação, limites e HMAC quando aplicável). O comando enviado também respeita preferências de compressão do frame (`default`, `none`, `always`). Detalhe do envelope, limites locais e erros típicos: [PayloadFrame](./payload-frame.md).

## Response Mode

`Response Mode` controla como a resposta chega ao n8n:

- `Aggregated JSON`: padrão. Linhas SQL viram itens quando possível; outros retornos viram JSON agregado.
- `Chunk Items`: útil para streams SQL via Socket. Chunks são convertidos em itens sem esperar montar tudo em uma lista única.
- `Raw JSON-RPC`: preserva o envelope RPC normalizado para depuração e fluxos avançados.

Se `Chunk Items` for usado em uma combinação que não produz stream, a execução cai para saída agregada.

## Buffer e Pull

Para streams grandes, o runtime aplica limites locais:

- máximo de itens de chunk em buffer
- máximo de linhas em buffer
- máximo de bytes agregados
- janela máxima de pull de stream

Esses limites evitam que um workflow consuma memória indefinidamente quando o agente retorna muito dado ou quando o consumidor demora para processar chunks.

## Fallback

O node prefere `agents:command` para `Channel = Socket`. Para fluxos de comando único, quando o servidor não responde ao transporte novo ou não devolve resposta correlacionada, a implementação pode usar o fluxo legado de relay. `Execute Batch` via Socket exige `agents:command` com correlação por `requestId`; se o servidor não suportar, use REST ou atualize o servidor.

## Metadados de Saída

Com `Include Plug Metadata = true`, a saída inclui `json.__plug` com metadados seguros, por exemplo:

```json
{
  "__plug": {
    "channel": "socket",
    "socketMode": "agentsCommand",
    "agentId": "agent-1",
    "requestId": "request-1"
  }
}
```

Os metadados não incluem SQL, tokens, senha, `clientToken` ou payloads binários.
