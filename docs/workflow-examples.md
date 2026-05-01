# Exemplos de workflow

## Exemplo 1: REST para SQL simples

Cenario:

- validar o contexto
- executar uma consulta SQL via REST
- seguir o workflow com um item por linha

Configuracao recomendada:

- operacao `Validate Context`
- depois operacao `Execute SQL`
- `Channel = REST`
- `Response Mode = Aggregated JSON`
- `Include Plug Metadata = true`

Exemplo de SQL:

```sql
SELECT id, name, status
FROM customers
WHERE status = :status
```

Exemplo de `Named Params JSON`:

```json
{
  "status": "active"
}
```

Resultado esperado:

- um item n8n por linha
- campo `__plug` com `channel`, `agentId` e `requestId` se metadata estiver ativada

## Exemplo 2: SOCKET para stream SQL

Cenario:

- usar o pacote interno
- executar consulta com relay socket
- obter rows agregadas ou chunks

Configuracao recomendada:

- pacote `n8n-nodes-plug-client-internal`
- operacao `Execute SQL`
- `Channel = SOCKET`
- `Response Mode = Aggregated JSON` para fluxo comum

Quando usar `Chunk Items`:

- debugging de stream
- processamento incremental de chunks

Observacao:

- `Execute Batch` continua `REST-only`
- o socket do v1 e por execucao, nao persistente

## Exemplo 3: diagnostico com Raw JSON-RPC

Quando usar:

- comparar envelope normalizado com a resposta do agente
- debugar variacoes de `meta`, `api_version` ou shape de resultado

Configuracao:

- `Response Mode = Raw JSON-RPC`
- opcionalmente `Include Plug Metadata = false` para reduzir ruido
