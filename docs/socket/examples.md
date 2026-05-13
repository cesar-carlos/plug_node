# Exemplos de Socket

Os exemplos abaixo usam nomes de parâmetros internos do n8n para facilitar revisão de workflows exportados.

## Executar SQL Via Socket

Node:

```json
{
  "type": "n8n-nodes-plug-database.plugDatabase",
  "typeVersion": 2,
  "parameters": {
    "resource": "sql",
    "operation": "executeSql",
    "channel": "socket",
    "inputMode": "guided",
    "responseMode": "chunkItems",
    "agentId": "agent-1",
    "clientToken": "client-token",
    "sql": "select * from customers limit 100",
    "includePlugMetadata": true
  }
}
```

Use `responseMode = "chunkItems"` quando espera stream ou muitas linhas. Para respostas pequenas, `aggregatedJson` é mais simples.

## Publicar Evento Por REST

```json
{
  "type": "n8n-nodes-plug-database.plugDatabase",
  "typeVersion": 2,
  "parameters": {
    "resource": "tools",
    "operation": "publishSocketEvent",
    "publishChannel": "rest",
    "eventName": "client:custom.status.changed",
    "payloadJson": "{\"status\":\"ready\",\"source\":\"n8n\"}",
    "payloadFrameCompression": "default",
    "idempotencyKey": "status-ready-{{$json.id}}",
    "timeoutMs": 30000,
    "includePlugMetadata": true
  }
}
```

## Publicar Evento Por Socket

```json
{
  "type": "n8n-nodes-plug-database.plugDatabase",
  "typeVersion": 2,
  "parameters": {
    "resource": "tools",
    "operation": "publishSocketEvent",
    "publishChannel": "socket",
    "eventName": "client:custom.order.created",
    "payloadJson": "{\"orderId\":\"{{$json.orderId}}\"}",
    "payloadFrameCompression": "default",
    "socketAckTimeoutMs": 10000,
    "includePlugMetadata": true
  }
}
```

## Aguardar Um Evento Inline

```json
{
  "type": "n8n-nodes-plug-database.plugDatabase",
  "typeVersion": 2,
  "parameters": {
    "resource": "tools",
    "operation": "waitForSocketEvent",
    "eventName": "client:custom.order.finished",
    "listenTimeoutMs": 60000,
    "socketAckTimeoutMs": 10000,
    "binaryPropertyPrefix": "attachment",
    "requirePayloadSignature": false,
    "includePlugMetadata": true
  }
}
```

Esse padrão é bom quando o workflow publica uma solicitação e precisa aguardar uma resposta específica antes de continuar.

## Trigger Para Eventos Customizados

```json
{
  "type": "n8n-nodes-plug-database.plugDatabaseSocketEventTrigger",
  "typeVersion": 1,
  "parameters": {
    "eventSource": "customEvents",
    "eventNames": {
      "values": [
        { "eventName": "client:custom.status.changed" },
        { "eventName": "client:custom.order.created" }
      ]
    },
    "ackTimeoutMs": 10000,
    "reconnectOnDisconnect": true,
    "maxReconnectAttempts": 0,
    "maxInflightEvents": 8,
    "maxQueueSize": 128,
    "overflowPolicy": "fail",
    "deduplicateEvents": true,
    "deduplicationTtlMs": 300000,
    "includePlugMetadata": true
  }
}
```

## Trigger Para Atualização de Perfil do Agent

```json
{
  "type": "n8n-nodes-plug-database.plugDatabaseSocketEventTrigger",
  "typeVersion": 1,
  "parameters": {
    "eventSource": "agentProfileUpdated",
    "ackTimeoutMs": 10000,
    "reconnectOnDisconnect": true,
    "requirePayloadSignature": true,
    "requirePayloadSignatureFor": "agentProfileUpdated",
    "includePlugMetadata": true
  }
}
```

## Workflow Publica e Outro Workflow Escuta

Workflow A:

1. `Plug Database > Tools > Publish Socket Event`
2. `Event Name = client:custom.invoice.ready`
3. `Payload JSON = {"invoiceId":"{{$json.id}}"}`

Workflow B:

1. `Plug Database Socket Event Trigger`
2. `Event Source = Custom Events`
3. `Event Names = client:custom.invoice.ready`
4. próximos nodes usam `{{$json.payload.invoiceId}}`

## Workflow Espera Resposta One-Shot

1. Execute uma ação que inicia processamento assíncrono.
2. Use `Wait for Socket Event`.
3. Configure `Event Name` com o evento de retorno esperado.
4. Use `Listen Timeout (MS)` maior que o tempo máximo esperado de processamento.
5. Continue o workflow com dados de `{{$json.payload}}`.

Esse padrão evita manter um trigger separado quando a espera pertence a uma execução específica.
