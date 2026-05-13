# Exemplos de Socket

Os ficheiros JSON em [`examples/`](./examples/) são workflows mínimos importáveis no n8n.

### Checklist pós-importação

1. Associe o nó à credencial **`Plug Database Account API`** (ou crie uma e selecione-a).
2. Substitua `__CONFIGURE_IN_N8N__` no `id` da credencial no JSON pelo id real da credencial na sua instância (após importar, o n8n costuma pedir remapeamento).
3. Preencha **`Agent ID`** e **`Client Token`** no nó ou deixe os defaults válidos na credencial, conforme a operação.
4. Confirme que a **URL base** do Plug na credencial corresponde ao ambiente (produção vs teste).

| Cenário                                  | Ficheiro                                                                                                          |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| SQL via Socket                           | [`sql-socket-workflow.json`](./examples/sql-socket-workflow.json)                                                 |
| Publicar evento (REST)                   | [`publish-socket-event-workflow.json`](./examples/publish-socket-event-workflow.json)                             |
| Aguardar um evento (one-shot)            | [`wait-for-socket-event-workflow.json`](./examples/wait-for-socket-event-workflow.json)                           |
| Trigger (eventos customizados)           | [`socket-event-trigger-workflow.json`](./examples/socket-event-trigger-workflow.json)                             |
| Trigger (`client:agent.profile.updated`) | [`socket-event-trigger-agent-profile-workflow.json`](./examples/socket-event-trigger-agent-profile-workflow.json) |

Validação no repositório: `npm run migrate:workflows:check-examples` (deve terminar sem migrações pendentes).

## Notas rápidas

- **SQL:** com `responseMode = chunkItems` use streams ou muitas linhas; para respostas pequenas, `aggregatedJson` costuma bastar (ver parâmetros no JSON de exemplo).
- **Publish:** REST é o caminho mais compatível para anexos grandes; Socket evita HTTP extra quando o fluxo já está em `/consumers` (detalhes em [Eventos customizados](./custom-events.md)).
- **Trigger perfil do agent:** use o JSON dedicado ou [Socket Event Trigger](./socket-event-trigger.md).

## Padrões de workflow

### Um workflow publica, outro escuta

**Workflow A:** `Plug Database > Tools > Publish Socket Event` — `Event Name = client:custom.invoice.ready`, `Payload JSON` com o identificador (por exemplo `invoiceId`).

**Workflow B:** `Plug Database Socket Event Trigger` — `Event Source = Custom Events`, mesmos nomes de evento; nos nós seguintes use expressões como `{{$json.payload.invoiceId}}`.

### Resposta one-shot na mesma execução

1. Dispare a ação assíncrona que deve gerar o evento de retorno.
2. Use `Wait for Socket Event` com o `Event Name` de retorno esperado.
3. Ajuste `Listen Timeout (MS)` acima do tempo máximo de processamento.
4. Continue o fluxo com `{{$json.payload}}`.

Evita manter um trigger ativo quando a espera pertence só a uma execução.
