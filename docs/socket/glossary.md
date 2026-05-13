# Glossário (Socket)

Definições curtas usadas na documentação desta pasta. Detalhe operacional continua nos guias linkados.

| Termo                                                            | Significado                                                                                                                           |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `/consumers`                                                     | Namespace Socket.IO onde o n8n autentica e corre SQL, publicação/wait de eventos e o trigger.                                         |
| `agents:command`                                                 | Evento usado para enviar comandos Plug (incluindo SQL) pelo consumer socket.                                                          |
| `agents:command_response` / `_stream_chunk` / `_stream_complete` | Resposta ao comando: única, chunks de stream ou conclusão do stream.                                                                  |
| `PayloadFrame`                                                   | Envelope JSON com payload opcionalmente gzip e assinatura HMAC; ver [PayloadFrame](./payload-frame.md).                               |
| `connection:ready`                                               | Confirmação do servidor após ligação ao `/consumers`; frequentemente transportada num `PayloadFrame`.                                 |
| `client:custom.*`                                                | Nome de evento customizado (prefixo obrigatório `client:custom.`); ver [Eventos customizados](./custom-events.md).                    |
| `socket:event.publish` / `socket:event.published`                | Pedido e ACK de publicação de evento customizado.                                                                                     |
| `socket:event.subscribe` / `subscribed`                          | Pedido e ACK de subscrição a um nome de evento exato.                                                                                 |
| `deliveryStatus`                                                 | Metadado de publicação: `delivered` vs `noRecipients`.                                                                                |
| `Require Payload Signature`                                      | Exige `PayloadFrame` assinado nas entradas; depende de `Payload Signing Key` na credencial.                                           |
| Backpressure                                                     | Fila e limite de itens em voo no trigger; ver [Socket Event Trigger](./socket-event-trigger.md).                                      |
| Relay (fallback)                                                 | Transporte socket legado para comando único quando o servidor não suporta o caminho preferido; ver [SQL via Socket](./sql-socket.md). |

Para erros e mensagens concretas, use [Troubleshooting](./troubleshooting.md).
