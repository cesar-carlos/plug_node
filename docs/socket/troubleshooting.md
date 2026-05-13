# Troubleshooting de Socket

## Checklist Inicial

1. Confirme que a credencial `Plug Database Account API` faz login.
2. Confirme que `Default Agent ID` e `Default Client Token` estão preenchidos ou foram informados no node.
3. Confirme que o servidor aceita o namespace `/consumers`.
4. Para eventos customizados, confirme que o nome começa com `client:custom.`.
5. Para assinatura, confirme `Payload Signing Key` e `Payload Signing Key ID`.
6. Se o menu antigo ainda aparece no n8n, desinstale `n8n-nodes-plug-database-advanced`, reinicie o n8n e recarregue o cache de community nodes.

## Erros de Conexão

| Sintoma ou código             | Significado                                                | Ação                                                                      |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------- |
| `SOCKET_CONNECT_ERROR`        | Falha ao abrir Socket.IO.                                  | Verifique URL base, rede, token e disponibilidade do servidor.            |
| timeout em `connection:ready` | O socket conectou, mas o servidor não confirmou prontidão. | Aumente o timeout ou verifique compatibilidade do namespace `/consumers`. |
| `SOCKET_DISCONNECTED`         | A conexão caiu durante escuta ou comando.                  | Use retry no workflow ou reconnect no trigger.                            |
| `NAMESPACE_DEPRECATED`        | Namespace antigo ou não suportado.                         | Use `/consumers` via pacote atual.                                        |

## Erros de Autorização

| Código                 | Significado                             | Ação                                         |
| ---------------------- | --------------------------------------- | -------------------------------------------- |
| `ACCOUNT_BLOCKED`      | Conta bloqueada no Plug.                | Corrija a conta antes de tentar novamente.   |
| `AGENT_ACCESS_REVOKED` | Acesso do client ao agent foi removido. | Solicite nova aprovação ao dono do agent.    |
| erro de login          | Credenciais inválidas.                  | Atualize usuário/senha na credencial global. |

## Erros de Comando SQL

| Código ou sintoma                     | Significado                                  | Ação                                                              |
| ------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------- |
| `VALIDATION_ERROR`                    | Payload do comando inválido.                 | Revise campos guiados ou JSON-RPC avançado.                       |
| `RATE_LIMITED` ou `TOO_MANY_REQUESTS` | Limite de requisições.                       | Respeite `retryAfterSeconds` quando presente.                     |
| `SERVICE_UNAVAILABLE`                 | Hub ou agent indisponível.                   | Tente novamente depois ou use REST se o Socket estiver degradado. |
| resposta excedeu buffer               | Resultado grande demais para limites locais. | Use filtros SQL, paginação ou `Chunk Items`.                      |

## Erros de Eventos Customizados

| Código ou sintoma                           | Significado                                         | Ação                                                                  |
| ------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------- |
| `Event Name must start with client:custom.` | Nome inválido.                                      | Use padrão `client:custom.alguma.coisa`.                              |
| `PAYLOAD_TOO_LARGE` ou validação local      | Payload/anexos excedem limites.                     | Reduza JSON, divida anexos ou use REST multipart.                     |
| `SUBSCRIPTION_LIMIT_EXCEEDED`               | Muitas inscrições no mesmo socket.                  | Reduza eventos por trigger ou divida workflows.                       |
| `SOCKET_EVENT_LISTEN_TIMEOUT`               | Listener one-shot assinou, mas não recebeu evento.  | Publique depois do listener iniciar ou aumente `Listen Timeout (MS)`. |
| `SOCKET_EVENT_BACKPRESSURE_LIMIT`           | Fila do trigger cheia com `Overflow Policy = Fail`. | Aumente fila/inflight, reduza volume ou escolha uma política de drop. |

<a id="socket-troubleshoot-hmac"></a>

## Assinatura HMAC

| Sintoma                                      | Significado                                              | Ação                                                                        |
| -------------------------------------------- | -------------------------------------------------------- | --------------------------------------------------------------------------- |
| `Payload Signing Key is required`            | O node exige assinatura, mas a credencial não tem chave. | Configure a chave ou desligue a exigência.                                  |
| `PayloadFrame signature is required`         | O frame chegou sem assinatura.                           | Configure assinatura no servidor ou ajuste `Require Payload Signature For`. |
| `PayloadFrame signature verification failed` | Assinatura não confere.                                  | Verifique a chave compartilhada e se o payload foi alterado.                |
| `PayloadFrame signature key_id mismatch`     | `key_id` diferente do configurado.                       | Alinhe `Payload Signing Key ID`.                                            |

<a id="socket-diagnostico-saida"></a>

## Diagnóstico de Saída

Habilite `Include Plug Metadata` para receber `json.__plug`. Os campos mais úteis são:

- `channel`
- `socketMode`
- `operation`
- `socketId`
- `requestId`
- `payloadFrameRequestId`
- `deliveryStatus`
- `reconnectAttempt`
- `subscriptionCount`
- `backpressure`

Esses metadados ajudam a diagnosticar fluxo e entrega sem expor credenciais ou payloads sensíveis.
