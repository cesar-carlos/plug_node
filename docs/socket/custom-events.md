# Eventos Customizados

Eventos customizados permitem que um workflow publique ou aguarde mensagens `client:custom.*` no Plug.

Existem duas operações em `Plug Database > Resource = Tools`:

- `Publish Socket Event`
- `Wait for Socket Event`

## Nome do Evento

O nome precisa começar com `client:custom.` e seguir o formato:

```text
client:custom.[A-Za-z0-9._:-]
```

Limites aplicados localmente:

- máximo de 128 caracteres
- precisa ter um caractere alfanumérico depois de `client:custom.`
- não há wildcard na inscrição do listener

Exemplos válidos:

```text
client:custom.status.changed
client:custom.order.created
client:custom.agent:ready
client:custom.sync-2026.done
```

## Publicar Evento

Use:

- `Resource = Tools`
- `Operation = Publish Socket Event`

Campos principais:

- `Publish Channel`: `REST` ou `Socket`.
- `Event Name`: evento exato `client:custom.*`.
- `Payload JSON`: JSON entregue aos assinantes. `null` é válido.
- `Payload Frame Compression`: `Default`, `None` ou `Always`.
- `Idempotency Key`: chave opcional para retry seguro.
- `Attachments`: propriedades binárias do item n8n.
- `Timeout (MS)`: timeout HTTP para REST.
- `Socket ACK Timeout (MS)`: timeout de `connection:ready` e `socket:event.published` quando `Publish Channel = Socket`.
- `Include Plug Metadata`: adiciona `json.__plug`.

### Publicação Por REST

`Publish Channel = REST` envia `POST /client/me/socket-events`.

Quando não há anexos, envia JSON. Quando há anexos, envia `multipart/form-data` com:

- campo `event` com o JSON do evento
- partes `files` para cada binário

REST é a opção mais compatível e recomendada para anexos maiores.

### Publicação Por Socket

`Publish Channel = Socket` abre `/consumers`, espera `connection:ready`, emite `socket:event.publish` e correlaciona `socket:event.published` por `requestId`.

Anexos são enviados inline como:

```json
{
  "fieldName": "data",
  "originalName": "report.pdf",
  "mimeType": "application/pdf",
  "sizeBytes": 12345,
  "base64": "..."
}
```

Use Socket para payloads pequenos ou quando o workflow precisa permanecer no caminho realtime.

## Limites de Payload e Anexos

A implementação valida localmente os mesmos limites esperados pelo servidor:

- payload JSON: até 524288 bytes UTF-8
- anexos: até 5 arquivos
- cada anexo: até 524288 bytes
- total de anexos: até 2097152 bytes

Se passar desses limites, a execução falha antes de enviar ao Plug.

## Saída da Publicação

Campos habituais incluem `success`, `eventId`, `eventName`, `recipients`, `requestId`, `idempotentReplay`. Com `Include Plug Metadata`, `json.__plug` inclui `channel`, `operation` (por exemplo `publishCustomSocketEvent`), `deliveryStatus` (`delivered` se houve pelo menos um destinatário; `noRecipients` se o evento foi aceite mas sem subscritores) e, em publicação por Socket, `publisherSocketId` quando disponível. Exemplo completo: [`examples/publish-socket-event-workflow.json`](./examples/publish-socket-event-workflow.json).

## Aguardar Um Evento

Use:

- `Resource = Tools`
- `Operation = Wait for Socket Event`

Essa operação é one-shot:

1. autentica
2. conecta em `/consumers`
3. espera `connection:ready`
4. emite `socket:event.subscribe`
5. aguarda o primeiro evento com o nome configurado
6. tenta `socket:event.unsubscribe`
7. fecha o socket

Campos:

- `Event Name`: evento exato.
- `Listen Timeout (MS)`: tempo máximo para aguardar o primeiro evento depois da inscrição.
- `Socket ACK Timeout (MS)`: timeout de conexão e ACKs de controle.
- `Binary Property Prefix`: prefixo dos binários criados a partir de anexos inline.
- `Require Payload Signature`: exige assinatura HMAC em frames recebidos.
- `Include Plug Metadata`: adiciona `json.__plug`.

## Saída do listener one-shot

O item segue o mesmo formato base que o trigger em eventos customizados (`eventId`, `eventName`, `emittedAt`, `publisher`, `payload`, `attachments`); com metadata, `__plug.operation` é `waitForSocketEvent` e inclui `socketId`, `receivedAt`, `subscriptionCount`, `attachmentCount`, entre outros. Ver [Socket Event Trigger — formato do item](./socket-event-trigger.md#custom-event-output) e o exemplo [`wait-for-socket-event-workflow.json`](./examples/wait-for-socket-event-workflow.json).

Anexos inline viram propriedades binárias do n8n (por exemplo `binary.attachment_0`).
