# Plug Database 3.8.0 no n8n — guia da equipe

O pacote `n8n-nodes-plug-database` **3.8.0** oferece dois recursos novos no nó **Plug Database**. Escolha **Agent Action I/O** para descobrir e executar aplicações cadastradas pelo **Action ID** no computador de destino. Escolha **SQL Extensions** para consultar a saúde do agente, identificar uma fonte de dados, inspecionar tabelas e views ou acompanhar uma operação SQL durável.

## Preparar o computador e o n8n

1. Peça ao responsável pelo computador que disponibilize a aplicação como ação no `plug_agente`, autorize a ação para o cliente e informe o **Agent ID**, o **Action ID** e, quando aplicável, o **Trigger ID**. Para o exemplo abaixo, escolha um programa de eco que copie a entrada para a saída e permaneça ativo enquanto a entrada estiver aberta.
2. Confirme que o agente está conectado ao Hub e oferece **Agent Action I/O v1**. Para listar ações, ele também precisa oferecer catálogo v1 e conceder ao cliente as permissões de listagem, execução e I/O.
3. No n8n com o pacote instalado, adicione **Plug Database**, selecione **Agent Action I/O** e configure as duas credenciais. A credencial da conta autentica no Hub. **Plug Agent API** identifica o agente e guarda o token provisionado nele. Use o gerenciador de credenciais do n8n.
4. Em **Channel**, selecione **REST**, **Socket** ou **Relay** conforme o ambiente. Os passos abaixo são os mesmos nos três canais. Desative **Retry On Fail** nos nós de ação. Uma queda de conexão pode ocorrer depois de o agente já ter iniciado o processo.

## Operações disponíveis

| Operação no n8n        | Quando usar                                                                                  |
| ---------------------- | -------------------------------------------------------------------------------------------- |
| List Available Actions | Descobrir as ações autorizadas para o cliente no computador selecionado.                     |
| Validate Run           | Conferir ação, trigger e autorização antes de iniciar o processo.                            |
| Run                    | Iniciar a ação e obter o `execution_id`. Pode incluir entrada inicial ou fechar a entrada.   |
| Find Execution         | Localizar a execução pelo Action ID e pela chave original quando a resposta de Run se perde. |
| Get Execution          | Consultar o estado da execução pelo ID.                                                      |
| Send Input             | Enviar um bloco para a entrada do processo, com sequência e identificador de mensagem.       |
| Close Input            | Sinalizar fim da entrada para programas que aguardam EOF.                                    |
| Get Input Status       | Consultar o recibo de uma mensagem de entrada pelo Execution ID e Message ID.                |
| Read I/O               | Ler eventos e bytes de stdout e stderr a partir de um checkpoint.                            |
| Cancel                 | Solicitar o cancelamento e depois conferir o estado com Get Execution.                       |

## Primeiro workflow, passo a passo

1. Comece com **Manual Trigger** e um nó **List Available Actions**. Deixe **Cursor** vazio. **Page Size** aceita de 1 a 50 e o padrão é 20. Se vier `next_cursor`, passe o valor sem alterações à próxima chamada com o mesmo agente e credencial. Pare quando for `null`. Uma página vazia é válida. Acesso negado é erro e exige revisão das permissões.
2. Adicione **Validate Run**. Informe o **Action ID** autorizado, o **Trigger ID** quando aplicável e uma **Idempotency Key** gerada e salva para esta execução pretendida. Prossiga se a validação permitir.
3. Adicione **Run**, dê ao nó o nome `Iniciar ação` e use os mesmos parâmetros. Para este exemplo, deixe a entrada aberta. Nos próximos nós, preencha **Execution ID** com a expressão abaixo. Ela usa o primeiro item de um workflow que inicia uma única ação.

   ```text
   {{ $('Iniciar ação').first().json.execution_id }}
   ```

4. Em **Send Input**, use **Input Sequence** igual a `0`, um **Message ID** único salvo antes do envio e **Input Format** igual a **Base64**. Envie `AP8NCkE=`, que representa os cinco bytes `00 ff 0d 0a 41`. Para um arquivo vindo de outro nó, selecione **n8n Binary**. Cada bloco admite até 64 KiB decodificados.
5. Em **Read I/O**, comece com o checkpoint inicial do nó. Consuma os eventos de saída na ordem recebida. Cada evento de saída também aparece em `binary.event_<sequence>`, com o fluxo e o deslocamento no JSON. No programa de eco, o stdout acumulado deve conter exatamente os cinco bytes enviados. Se a primeira página ainda não trouxer todos os bytes, continue lendo.
6. Com o eco ainda aguardando entrada, execute **Cancel**. Consulte **Get Execution** até obter `status = cancelled` e `flags.terminal = true`. Para um programa que deve concluir normalmente ao receber EOF, use **Close Input** com a próxima sequência e um novo Message ID. Continue lendo a saída até confirmar `output_complete`.

## Retomar após timeout, desconexão ou reinício do n8n

| O que aconteceu                                   | Como retomar                                                                                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ficou sem resposta                            | Use **Find Execution** com a chave original e o Action ID. Recupere o Execution ID e consulte **Get Execution**. Uma chave nova representa outra solicitação de execução.                                                                           |
| A resposta de Send Input ou Close Input se perdeu | Consulte **Get Input Status** com os identificadores originais antes de decidir sobre o envio. Um recibo de escrita não confirma que a aplicação processou os dados. Se o resultado continuar incerto, reconcilie com o responsável pela aplicação. |
| A leitura parou ou o n8n reiniciou                | Recupere o Execution ID e o último checkpoint persistido. Em **Read I/O**, retome com a sequência e os offsets de stdout e stderr. Só avance para `next_sequence` e `next_offsets` após consumir a página inteira.                                  |

O workflow é responsável por guardar os identificadores e o checkpoint em armazenamento durável. Se o destino da saída puder receber a mesma página após uma falha, registre o evento por execução, sequência e deslocamento para evitar duplicação. O término do processo e a captura completa da saída são condições distintas. Para entrada e saída simultâneas, mantenha a leitura e o envio em execuções independentes, de modo que uma leitura em espera não bloqueie a entrada da qual o programa depende.

## SQL Extensions no n8n

Use as mesmas duas credenciais de Hub e agente, escolha o canal e desative **Retry On Fail**. Em cada nó, selecione **Resource → SQL Extensions** e a operação indicada abaixo. O Hub e o agente precisam ter negociado a extensão correspondente. Os exemplos usam nomes ilustrativos de homologação. Substitua o banco, a tabela e os identificadores pelos do ambiente. O nó injeta o token pela credencial.

### Monitorar a saúde do agente

Monte **Schedule Trigger → Get Agent Health → IF**. **Get Agent Health** dispensa o campo **Parameters**. No **IF**, compare `{{ $json.status }}` com `degraded`. Nesse ramo, registre o agente, o horário (`timestamp`), os erros (`queries.errors`) e a latência p95 (`queries.p95_latency_ms`). O outro estado previsto é `healthy`. A resposta também informa versão, tempo em atividade, tamanho do pool e se a fila SQL está habilitada. Se a chamada falhar por desconexão ou permissão, trate a falha do nó separadamente de um agente que respondeu `degraded`.

### Identificar a fonte e inspecionar uma tabela

1. Monte **Manual Trigger → Describe Source → Describe Schema**. Nomeie o primeiro nó Plug **Fonte**. Em **Parameters** de **Describe Source**, use `{"contractVersion":1,"database":"homologacao"}`. A resposta traz o banco, o dialeto, a versão do motor e o `identityHash`.
2. Em **Describe Schema**, coloque **Parameters** em modo **Expression** e use a expressão abaixo. Ela vincula a inspeção à fonte identificada pelo nó anterior. O exemplo pressupõe uma tabela SQL Server chamada `dbo.Cliente`.

   ```javascript
   {
     {
       JSON.stringify({
         contractVersion: 1,
         database: $json.database,
         expectedSource: {
           version: 1,
           dialect: $json.dialect,
           identityHash: $json.identityHash,
         },
         resources: [{ schema: "dbo", name: "Cliente", type: "table" }],
         offset: 0,
         pageSize: 1,
       });
     }
   }
   ```

3. Examine as colunas e restrições devolvidas antes de preparar uma escrita. A lista aceita até 16 recursos distintos e cada página aceita de 1 a 4 recursos. Para várias páginas, conserve a mesma lista e identidade e avance o offset. Em planos que dependem de uma estrutura específica, use `expectedSource` e `expectedStructure` juntos, com a nulabilidade conhecida e apenas restrições confirmadas como habilitadas. O SQL avançado também preserva essas expectativas em `sql.execute`.

### Executar, consultar e cancelar uma operação SQL durável

Exemplo de homologação: alterar o estado de **um** registro preparado para teste. Use **Manual Trigger → Edit Fields → Execute Operation → Get Operation**. Nomeie o nó **Edit Fields** como **Referência SQL** e forneça nele os campos `operationId` (UUID novo para essa intenção), `fingerprint` (SHA-256 do plano conforme o contrato), `sourcePhysicalId` (SHA-256 da identidade física da fonte) e `database`. Ambos os hashes usam 64 caracteres hexadecimais minúsculos. Obtenha esses valores de quem prepara o plano e persista a referência antes do envio para poder retomá-la após reinício. Use uma linha de teste com ID 42 e ajuste os nomes à estrutura inspecionada.

Em **Execute Operation → Parameters**, selecione **Expression**:

```javascript
{
  {
    JSON.stringify({
      contractVersion: 1,
      operationId: $json.operationId,
      fingerprint: $json.fingerprint,
      sourcePhysicalId: $json.sourcePhysicalId,
      database: $json.database,
      timeoutMs: 30000,
      maxAffectedRows: 1,
      steps: [
        {
          id: "atualizar",
          effect: "update",
          sql: "UPDATE dbo.PedidoTeste SET estado = :estado WHERE id = :id",
          params: {
            estado: { kind: "value", scalar: { type: "string", value: "revisado" } },
            id: { kind: "value", scalar: { type: "integer", value: "42" } },
          },
          outputs: {},
          affectedRows: { min: 1, max: 1 },
        },
      ],
    });
  }
}
```

O plano aceita de 1 a 32 etapas ordenadas e exige ao menos uma escrita. Cada escrita declara limites de linhas afetadas. Uma etapa pode consumir uma saída declarada de etapa anterior com `kind: "step_output"`. Inteiros e decimais são enviados como strings para preservar a precisão. O limite é de 1 MiB de SQL por etapa, 2 MiB para os parâmetros do plano e até 300 segundos de execução. Uma chamada do nó pode expirar antes de o agente terminar.

Em **Get Operation → Parameters**, use a expressão abaixo. **Cancel Operation** recebe exatamente a mesma referência. Para cancelar a partir de outra execução do n8n, carregue esses campos do registro persistido.

```javascript
{
  {
    JSON.stringify({
      contractVersion: 1,
      operationId: $("Referência SQL").first().json.operationId,
      fingerprint: $("Referência SQL").first().json.fingerprint,
      sourcePhysicalId: $("Referência SQL").first().json.sourcePhysicalId,
      database: $("Referência SQL").first().json.database,
    });
  }
}
```

Use **IF** sobre `{{ $json.state }}`. Em `executando`, aguarde com **Wait** antes de consultar de novo e limite o número de consultas. Em `concluida`, confira `directlyAffectedRows`. Se precisar interromper, chame **Cancel Operation** e consulte **Get Operation** até conhecer o desfecho. `cancelamento_solicitado` confirma o pedido. Só `rollback_confirmado` confirma a reversão. Se o estado for `resultado_desconhecido` ou houver timeout no envio, consulte a referência original e reconcilie os efeitos antes de decidir sobre outra escrita.

## Outras mudanças da versão

- **Diagnóstico e transporte.** Os erros em português distinguem recursos indisponíveis, desabilitados, incompatíveis e não implementados. Uma recusa do relay chega imediatamente com o diagnóstico do Hub. O nó rejeita respostas de outro agente no relay e ignora respostas Socket anteriores ao envio. Em **Continue On Fail**, preserve o código estruturado de autorização ao tratar um catálogo negado.
- **MCP e AI Hub.** O limite de chamadas MCP considera o conjunto de itens de entrada. Uma configuração de limite inválida ou um AI Hub explicitamente configurado que não pôde ser localizado gera erro.
- **Pacote e compatibilidade.** A publicação exclui os mapas de código usados no desenvolvimento, preservando os arquivos de execução, os nós e as credenciais registrados. Os workflows SQL existentes continuam compatíveis. A atualização das dependências também corrige a escrita de números por extenso em português: 1001 passa a produzir “Mil E Um”.
- **Desempenho e manutenção.** A contagem de bytes de saída em base64 evita uma decodificação redundante. A versão também reforça a validação de dependências e da publicação. [Changelog completo da 3.8.0](https://github.com/cesar-carlos/plug_node/blob/3b7726f/packages/n8n-nodes-plug-database/CHANGELOG.md)

## O que foi validado

Em um workflow real do n8n 2.45.7, cada canal iniciou um processo de eco no Windows, devolveu os cinco bytes esperados e confirmou o cancelamento da mesma execução. Esse ensaio cobriu o controle do processo e seus fluxos de bytes. A exibição de janela na sessão gráfica do usuário não fez parte do ensaio.

- [Contrato de comunicação, limites e resultados dos testes](https://github.com/cesar-carlos/plug_node/blob/3b7726f/docs/communication-alignment.md)
- [Workflow de referência com os três canais e as verificações de saída](https://github.com/cesar-carlos/plug_node/blob/3b7726f/scripts/fixtures/action-workflow.cjs)
- [Pacote 3.8.0 no npm](https://www.npmjs.com/package/n8n-nodes-plug-database/v/3.8.0)
