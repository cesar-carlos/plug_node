# Socket Event Trigger

`Plug Database Socket Event Trigger` inicia um workflow quando eventos chegam pelo Socket.

Use o trigger quando o workflow precisa ficar ativo escutando eventos. Para aguardar apenas um evento dentro de uma execução normal, use `Plug Database > Resource = Tools > Operation = Wait for Socket Event`.

## Fontes de Evento

`Event Source = Custom Events`

- assina eventos exatos `client:custom.*`
- usa `socket:event.subscribe`
- remove assinatura com `socket:event.unsubscribe` no fechamento
- não suporta wildcard

`Event Source = Agent Profile Updated`

- escuta `client:agent.profile.updated`
- não emite subscribe/unsubscribe customizado
- útil quando alterações no perfil do agent precisam disparar automações

## Ativação

Ao ativar o workflow, o trigger:

1. lê a credencial `Plug Database Account API`
2. autentica por REST
3. abre Socket.IO em `/consumers`
4. aguarda `connection:ready`
5. registra handlers de evento
6. mantém a conexão aberta até o workflow ser desativado ou a execução manual encerrar

Em execução manual, `Manual Listen Timeout (MS)` controla por quanto tempo o listener fica aberto. Valor `0` mantém a escuta até parar manualmente.

## Reconnect

Campos:

- `Reconnect On Disconnect`: habilita reconnect para falhas retryable.
- `Max Reconnect Attempts`: `0` significa tentativas ilimitadas.
- `Reconnect Initial Delay (MS)`: atraso inicial antes de jitter/backoff.
- `Reconnect Max Delay (MS)`: teto do atraso.
- `Reconnect Failure Window (MS)`: janela do circuit breaker.
- `Max Reconnect Failures in Window`: `0` desativa o circuit breaker.

Erros retryable incluem falhas temporárias de conexão, disconnects e algumas respostas `app:error`. Erros de autenticação, como `ACCOUNT_BLOCKED` e `AGENT_ACCESS_REVOKED`, são tratados como permanentes.

## Backpressure

O trigger prepara itens n8n de forma assíncrona. Para evitar acúmulo ilimitado:

- `Max Inflight Events`: quantos eventos podem ser preparados ao mesmo tempo. Padrão `8`.
- `Max Queue Size`: quantos eventos ficam em fila quando todos os slots estão ocupados. Padrão `128`.
- `Overflow Policy`:
  - `Fail`: emite erro quando a fila está cheia.
  - `Drop Newest`: descarta o evento novo.
  - `Drop Oldest`: remove o evento mais antigo da fila e aceita o novo.

Com `Include Plug Metadata = true`, cada item customizado recebe:

```json
{
  "__plug": {
    "backpressure": {
      "queuedCount": 0,
      "inflightCount": 1,
      "droppedNewestCount": 0,
      "droppedOldestCount": 0
    }
  }
}
```

## Deduplicação

Campos:

- `Deduplicate Events`: ignora eventos customizados repetidos com o mesmo `eventId`.
- `Deduplication TTL (MS)`: tempo em memória para lembrar IDs já emitidos. Padrão `300000`.

A deduplicação é local ao processo n8n. Se houver múltiplas instâncias n8n, cada uma tem sua própria memória.

## Assinatura de Payload

Campos:

- `Require Payload Signature`
- `Require Payload Signature For`

Opções de escopo:

- `All Event Sources`
- `Custom Events Only`
- `Agent Profile Updated Only`

Quando habilitado, frames recebidos precisam trazer assinatura HMAC SHA-256 válida. A chave vem da credencial `Payload Signing Key`. Se `Payload Signing Key ID` estiver definido, o `key_id` do frame precisa bater.

## Saída Para Eventos Customizados

```json
{
  "eventId": "evt_123",
  "eventName": "client:custom.status.changed",
  "emittedAt": "2026-05-13T12:00:00.000Z",
  "publisher": {
    "principalType": "client",
    "clientId": "client-1"
  },
  "payload": {
    "status": "ready"
  },
  "attachments": [],
  "__plug": {
    "channel": "socket",
    "socketMode": "customEvent",
    "eventName": "client:custom.status.changed",
    "eventId": "evt_123",
    "receivedAt": "2026-05-13T12:00:01.000Z",
    "socketId": "socket-1",
    "reconnectAttempt": 0,
    "subscriptionCount": 1,
    "payloadFrameRequestId": "frame-1"
  }
}
```

## Saída Para Agent Profile Updated

```json
{
  "eventName": "client:agent.profile.updated",
  "payload": {
    "agent_id": "agent-1",
    "profile_version": 3,
    "changed_fields": ["tools"]
  },
  "__plug": {
    "channel": "socket",
    "socketMode": "agentProfileUpdated",
    "eventName": "client:agent.profile.updated",
    "receivedAt": "2026-05-13T12:00:01.000Z",
    "socketId": "socket-1"
  }
}
```

## Boas Práticas

- Use nomes de evento específicos, como `client:custom.order.created`, em vez de reaproveitar um evento genérico para muitas finalidades.
- Ligue deduplicação quando o publisher usa retry com a mesma semântica de evento.
- Use `Overflow Policy = Fail` quando perda de evento for inaceitável.
- Use `Drop Oldest` ou `Drop Newest` somente em eventos de telemetria ou status onde o dado mais recente basta.
- Configure assinatura obrigatória em ambientes onde eventos cruzam fronteiras de confiança.
