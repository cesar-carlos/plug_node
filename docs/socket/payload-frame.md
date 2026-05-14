# PayloadFrame

Relacionado: [SQL via Socket](./sql-socket.md) (`connection:ready` e comandos), [Eventos customizados](./custom-events.md) (eventos recebidos) e [Troubleshooting](./troubleshooting.md) (erros de assinatura e tamanho).

`PayloadFrame` é o envelope JSON usado por partes da superfície Socket para transportar payloads JSON com compressão opcional e assinatura opcional.

Ele aparece em:

- `connection:ready`
- eventos customizados recebidos
- `client:agent.profile.updated`
- respostas ou chunks que usam o codec compartilhado

## Formato

```json
{
  "schemaVersion": "1.0",
  "enc": "json",
  "cmp": "gzip",
  "contentType": "application/json",
  "originalSize": 2048,
  "compressedSize": 512,
  "payload": "base64...",
  "traceId": "trace-1",
  "requestId": "request-1",
  "signature": {
    "alg": "hmac-sha256",
    "value": "base64-signature",
    "key_id": "key-1"
  }
}
```

Campos aceitos:

- `schemaVersion`: precisa ser `1.0`.
- `enc`: precisa ser `json`.
- `cmp`: `none` ou `gzip`.
- `contentType`: precisa ser `application/json`.
- `originalSize`: tamanho do JSON antes de gzip.
- `compressedSize`: tamanho do payload transportado.
- `payload`: bytes ou base64.
- `traceId`: opcional.
- `requestId`: opcional.
- `signature`: opcional.

Campos desconhecidos são rejeitados para evitar ambiguidades de contrato.

## Compressão

O codec suporta:

- `none`: JSON sem gzip.
- `gzip`: JSON comprimido.

Na criação do frame:

- `default` considera gzip quando o payload tem pelo menos 1024 bytes e economiza pelo menos 64 bytes.
- `always` força gzip quando há payload.
- `none` evita gzip.

Limites locais:

- entrada gzip: até 512 KiB
- payload comprimido: até 10 MiB
- payload decodificado: até 10 MiB
- razão máxima de inflação: 20x

Na decodificação, a assinatura HMAC é verificada antes de qualquer descompressão. Depois disso, `originalSize`, `compressedSize` e a razão esperada de inflação são validados antes do `gunzip`; o `gunzip` também roda com limite de saída de 10 MiB. Isso reduz o risco de payloads maliciosos inflarem demais no processo n8n.

<a id="assinatura-hmac"></a>

## Assinatura HMAC

Assinatura usa:

```text
hmac-sha256
```

A entrada assinada combina metadados normalizados e bytes do payload. Isso evita que alguém altere `cmp`, `requestId`, tamanhos ou conteúdo sem invalidar a assinatura.

Configuração no n8n:

- `Payload Signing Key`: chave usada para verificar ou emitir assinatura.
- `Payload Signing Key ID`: identificador opcional exigido quando o frame traz `key_id`.

Se o frame chega com assinatura mas a credencial não tem chave, a decodificação falha. Se `Require Payload Signature` estiver habilitado e o frame chega sem assinatura, a execução falha antes de emitir item.

## Erros Comuns

- `PayloadFrame schemaVersion must be 1.0`: versão não suportada.
- `PayloadFrame cmp must be none or gzip`: compressão desconhecida.
- `PayloadFrame exceeds the 10 MiB decoded limit`: payload grande demais depois de descompactar.
- `PayloadFrame exceeded the allowed gzip inflation ratio`: gzip com razão de inflação acima do limite local.
- `PayloadFrame signature verification failed`: HMAC inválido.
- `PayloadFrame signature key_id mismatch`: `key_id` do frame não bate com a credencial.

## Benchmark local

Para medir o custo local de decode em caminhos comuns e rejeições de segurança:

```bash
npm run bench:payload-frame
```

O script sincroniza `shared`, compila o pacote e mede PayloadFrames pequenos, gzip normal, gzip forçado e rejeição por metadados de inflação. Ajuste `PLUG_BENCH_ITERATIONS` para aumentar ou reduzir as iterações.
