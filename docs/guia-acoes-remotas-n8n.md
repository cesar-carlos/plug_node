# Plug Database 3.8.0 no n8n — guia da equipe

O pacote `n8n-nodes-plug-database` **3.8.0** oferece dois recursos novos no nó **Plug Database**. Escolha **Agent Action I/O** para descobrir e executar aplicações cadastradas pelo **Action ID** no computador de destino. Escolha **SQL Extensions** para consultar a saúde do agente, identificar uma fonte de dados, inspecionar tabelas e views ou acompanhar uma operação SQL durável.

## Preparar o computador e o n8n

1. Peça ao responsável pelo computador que disponibilize a aplicação como ação no `plug_agente`, autorize a ação para o cliente e informe o **Agent ID**, o **Action ID** e, quando aplicável, o **Trigger ID**. Para o exemplo abaixo, escolha um programa de eco que copie a entrada para a saída e permaneça ativo enquanto a entrada estiver aberta.
2. Confirme que o agente está conectado ao Hub e oferece **Agent Action I/O v1**. Para listar ações, ele também precisa oferecer catálogo v1 e conceder ao cliente as permissões de listagem, execução e I/O.
3. No n8n com o pacote instalado, adicione **Plug Database**, selecione **Agent Action I/O** e selecione a credencial de conta para autenticar no Hub. Em **Agent Credential Source**, escolha **Use Account Credential Only** para usar somente essa credencial, preenchendo **Default Agent ID** e **Default Client Token** com os dados provisionados no agente. Ou mantenha **Use Separate Agent Credential** e selecione uma **Plug Agent API** com **Agent ID** e **Local Client Token**. Use a mesma origem em todos os nós da ação.
4. Em **Channel**, selecione **REST**, **Socket** ou **Relay** conforme o ambiente. Os passos abaixo são os mesmos nos três canais. Desative **Retry On Fail** nos nós de ação. Uma queda de conexão pode ocorrer depois de o agente já ter iniciado o processo.

Workflows existentes continuam usando **Use Separate Agent Credential**, inclusive quando o novo campo não está salvo. A opção de conta precisa ser escolhida explicitamente em cada nó. Não há fallback nem combinação de campos entre credenciais: se faltar Agent ID ou token na origem escolhida, o nó falha antes do login. O teste de conexão da conta verifica apenas o login no Hub; mantenha o **Validate Run** para conferir a ação e suas permissões. Essa opção simplifica as credenciais, sem eliminar os nós de execução e leitura.

Exemplos importáveis: [eco UTF-8 com conta única](./socket/examples/action-account-echo-workflow.json) e [saúde/fonte SQL com conta única](./socket/examples/sql-extensions-account-workflow.json). Instale primeiro o pacote que oferece **Agent Credential Source**; selecione a conta em cada nó e substitua os identificadores ilustrativos. O exemplo de catálogo com credenciais separadas continua disponível para comparar permissões.

O nó agora informa a origem selecionada e onde conferir os campos. Em recusas de escopo, mantém o código e a informação de efeitos possíveis, acrescentando a orientação da credencial escolhida sem mostrar valores. Acesso negado não aciona uma tentativa com outra credencial.

## Entrada de texto e seleção pelo catálogo

Para enviar texto simples, selecione **Input Format → Text UTF-8** e preencha **Input Text**, por exemplo, com `ação 🌱`. O nó codifica uma vez para UTF-8/base64, sem adicionar quebra de linha, normalizar acentos ou alterar espaços. O limite continua sendo 64 KiB por bloco, medido em bytes, não caracteres. Texto vazio envia um bloco vazio; o fechamento da entrada depende de **Close Input After Initial Input** ou **Close Input**. Base64 continua sendo o padrão dos workflows antigos e permanece sem recodificação; Binário também continua disponível.

Em **Choose Action**, mantenha **Enter ID or Expression** para informar o ID, ou escolha **Select From Authorized Catalog** e selecione **Authorized Action**. Cada página consulta até 50 ações com a credencial e o canal selecionados, sem iniciar processos. Uma lista vazia é válida; acesso negado continua sendo erro. A listagem exige os escopos de catálogo, além dos necessários à execução. Depois de mudar o agente, credencial ou canal, recarregue a lista e selecione novamente a ação. O nome é apenas uma descrição; o ID salvo é usado no comando.

A seleção não elimina **Validate Run**, nem escolhe automaticamente um Trigger ID. Se uma ação não for elegível para I/O, o catálogo a identifica para revisão. Para recuperar uma execução perdida, use o **Action ID original** e a chave persistida em **Find Execution**, mesmo que a ação não apareça mais no catálogo.

As mensagens de falha orientam a recuperação: **Find Execution** após perda da resposta de Run; **Get Input Status** após perda da confirmação de entrada; **Read I/O** com o último checkpoint consumido após desconexão da leitura; **Get Execution** para confirmar cancelamento. Nenhuma dessas orientações reenvia comandos automaticamente.

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
6. Com o eco ainda aguardando entrada, execute **Cancel**. Consulte **Get Execution** até obter `status = cancelled` e `flags.terminal = true`. Para um programa que deve concluir normalmente ao receber EOF, use **Close Input** com a próxima sequência e um novo Message ID. Continue lendo até consumir o evento `completed`; exija `output_complete = true` nesse evento e ausência de `failure`.

## Teste de eco com término normal

Se já conhece o **Action ID**, comece pelo **Validate Run**. A listagem é opcional. Para validar, executar e ler o eco, a credencial local precisa permitir a ação e ter os escopos `agent_actions.validate_run`, `agent_actions.run`, `agent_actions.io` e `agent_actions.read_execution`. Ao substituir o token no agente, atualize **Default Client Token** na credencial de conta ou **Local Client Token** na **Plug Agent API**, conforme a origem selecionada.

1. Em um nó **Edit Fields** chamado `Referencia`, defina `inputBase64` como `YcOnw6NvIPCfjLE=` e `echo` como `ação 🌱` (texto esperado para a comparação). Em **Validate Run** e **Run**, use o mesmo Action ID, Trigger ID (se aplicável) e chave de idempotência. Ative **Include Initial Input** e **Close Input After Initial Input**, selecione **Input Format → Base64** e preencha **Input Base64** com `{{ $('Referencia').item.json.inputBase64 }}`. O fechamento sinaliza EOF para a aplicação.
2. Coloque um **IF** depois do preflight e prossiga para **Run** somente quando `{{ $json.valid }}` for verdadeiro. Use o `execution_id` devolvido por **Run** em **Read I/O** e **Get Execution**.
3. Leia até consumir o evento `completed` com `output_complete = true` e sem `failure`, e consulte o estado até `flags.terminal = true`. Os campos `terminal` e `output_complete` da página descrevem o estado no agente: podem estar verdadeiros enquanto ainda existem páginas por ler. No script de eco usado no teste da Campo e Lavoura, exija `status = succeeded`, `process.exit_code = 0` e a linha `PLUG_REMOTE_ECHO=ação 🌱` no stdout. Mantenha `echo` consistente com o conteúdo representado por `inputBase64`; ele é a expectativa do teste, não a fonte da entrada enviada.

### Base64 no envio e na leitura

O campo `inputBase64` já contém os bytes codificados. Passe-o diretamente nos dois nós: não aplique `.base64Encode()` novamente e não acrescente `\n` ou outros caracteres. O exemplo representa exatamente 11 bytes UTF-8 (`61 c3 a7 c3 a3 6f 20 f0 9f 8c b1`), sem quebra de linha. Codificar novamente faria a aplicação receber o texto Base64 em vez de `ação 🌱`.

O plug_node valida e encaminha o Base64 em `io.initial_input_base64`; o plug_agente o decodifica para os bytes entregues ao stdin da aplicação. Na volta, **Read I/O** mantém `events[].data_base64` no JSON e disponibiliza os bytes decodificados em `binary.event_<sequence>`. O nó **Saida da execucao** do workflow de teste decodifica os eventos, concatena os buffers de cada stream na ordem recebida e só então converte para UTF-8. Não converta cada chunk isoladamente para texto: um caractere pode estar dividido entre chunks.

Para comparar o eco em bytes, extraia do stdout acumulado apenas o conteúdo após `PLUG_REMOTE_ECHO=` e antes do CRLF adicionado pelo script, e compare com `Buffer.from(inputBase64, 'base64')`. Os metadados e a quebra de linha produzidos pelo script não fazem parte da entrada original.

### Evidência de eco UTF-8 nos três canais

Testes manuais reais realizados em **6 de novembro de 2026**, no workflow **Plug teste de ação remota**, usando a credencial Campo e Lavoura. Em cada teste, **Validate Run**, **Run**, **Read I/O** e **Get Execution** usaram o canal indicado, com uma chave de idempotência nova para a execução pretendida. A entrada foi `YcOnw6NvIPCfjLE=` nos três casos, sem recodificação.

| Canal  | Execução n8n                                                                               | Preflight      | Bytes do eco  | Saída completa | Código de saída | stderr |
| ------ | ------------------------------------------------------------------------------------------ | -------------- | ------------- | -------------- | --------------- | ------ |
| REST   | [100696](https://n8n.se7esistemassinop.com.br/workflow/Em3d2MEo8U03ZYp4/executions/100696) | `valid = true` | 11, idênticos | `true`         | `0`             | vazio  |
| Socket | [100699](https://n8n.se7esistemassinop.com.br/workflow/Em3d2MEo8U03ZYp4/executions/100699) | `valid = true` | 11, idênticos | `true`         | `0`             | vazio  |
| Relay  | [100700](https://n8n.se7esistemassinop.com.br/workflow/Em3d2MEo8U03ZYp4/executions/100700) | `valid = true` | 11, idênticos | `true`         | `0`             | vazio  |

Em todos os casos, o processo terminou com `status = succeeded` e `terminal = true`. O conteúdo do eco retornou exatamente `ação 🌱`, e sua representação Base64 voltou a ser `YcOnw6NvIPCfjLE=` na comparação dos bytes. Após os testes, os quatro nós foram restaurados para **REST**, mantendo o exemplo UTF-8 em `Referencia`.

Os links exigem acesso à instância n8n e dependem da retenção das execuções. Esta evidência confirma os testes daquela data; não garante disponibilidade contínua do agente nem constitui teste de reconexão ou de carga.

Se o preflight retornar `scope_or_action_denied`, confira os escopos e a lista de ações permitidas na credencial local. Para `NOT_FOUND`, compare o Agent ID da credencial selecionada, o **Action ID** e o **Trigger ID** com os usados na chamada direta que passou. Deixe o Trigger ID vazio quando a chamada direta o omitir. O código sozinho não identifica qual recurso faltou.

## Retomar após timeout, desconexão ou reinício do n8n

| O que aconteceu                                   | Como retomar                                                                                                                                                                                                                                        |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Run ficou sem resposta                            | Use **Find Execution** com a chave original e o Action ID. Recupere o Execution ID e consulte **Get Execution**. Uma chave nova representa outra solicitação de execução.                                                                           |
| A resposta de Send Input ou Close Input se perdeu | Consulte **Get Input Status** com os identificadores originais antes de decidir sobre o envio. Um recibo de escrita não confirma que a aplicação processou os dados. Se o resultado continuar incerto, reconcilie com o responsável pela aplicação. |
| A leitura parou ou o n8n reiniciou                | Recupere o Execution ID e o último checkpoint persistido. Em **Read I/O**, retome com a sequência e os offsets de stdout e stderr. Só avance para `next_sequence` e `next_offsets` após consumir a página inteira.                                  |

O workflow é responsável por guardar os identificadores e o checkpoint em armazenamento durável. Se o destino da saída puder receber a mesma página após uma falha, registre o evento por execução, sequência e deslocamento para evitar duplicação. O término do processo e a captura completa da saída são condições distintas. Para entrada e saída simultâneas, mantenha a leitura e o envio em execuções independentes, de modo que uma leitura em espera não bloqueie a entrada da qual o programa depende.

## SQL Extensions no n8n

Use a credencial de conta e a mesma opção **Agent Credential Source** descrita acima (conta ou credencial separada), escolha o canal e desative **Retry On Fail**. Em cada nó, selecione **Resource → SQL Extensions** e a operação indicada abaixo. O Hub e o agente precisam ter negociado a extensão correspondente. Os exemplos usam nomes ilustrativos de homologação. Substitua o banco, a tabela e os identificadores pelos do ambiente. O nó injeta o token pela credencial.

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

## Leitura completa, output_drained e checkpoint

Read I/O mantém os campos existentes e acrescenta `output_drained`: verdadeiro somente quando a página contém o evento `completed`. Esse indicador confirma o consumo do fim da captura, inclusive quando houve falha. Para aceitar a saída, confira também `completed.output_complete` e a ausência de `failure`. Os indicadores globais `terminal` e `output_complete` podem estar verdadeiros em páginas intermediárias.

A operação **Read Complete Output** é opcional e usa as mesmas credenciais e canais REST, Socket e relay. Ela lê uma execução existente; não executa Run, não reenvia entrada e não repete automaticamente uma leitura que falhou.

- Configure Execution ID, After Sequence e os dois offsets. Na primeira leitura use zero; na retomada use exatamente o checkpoint salvo.
- Max Total Bytes limita os bytes entregues nesta chamada (padrão 8 MiB, teto 64 MiB). Nenhum chunk é dividido: um orçamento menor que o próximo chunk retorna sem avançar; use pelo menos 64 KiB para garantir espaço para um chunk.
- Read Time Limit limita a leitura a 30 segundos por padrão, com teto de 300 segundos. O relógio começa após autenticação e criação do transporte. A chamada interrompe leituras de rede; uma gravação binária já iniciada precisa terminar antes de devolver seu checkpoint.
- Há limites adicionais de 4.096 páginas e 4.096 chunks por chamada. Os limites existentes do agente continuam valendo.
- É necessário armazenamento binário externo do n8n (por exemplo filesystem, ou um backend externo suportado pela instalação). O modo inline é recusado com `EXTERNAL_BINARY_STORAGE_REQUIRED` após, no máximo, um chunk; não há fallback que acumule o arquivo em Base64.

A resposta contém `binary.event_N` e uma lista `parts` com campo binário, stream, sequência, offset e tamanho. stdout e stderr permanecem separados por metadados, com seus bytes originais. Não há concatenação automática, conversão para texto nem um arquivo único. Encaminhe os blocos a um destino que aceite escrita incremental; ordene pelo offset de cada stream e valide continuidade.

O JSON inclui `next_sequence`, `next_offsets`, `bytes_read`, `pages_read`, `process_exit_code`, `output_drained`, `output_complete` e `stop_reason`. O código do processo só está disponível se seu evento foi consumido nesta chamada; em uma retomada pode ser null, exigindo Get Execution.

`stop_reason` pode ser `completed`, `byte_limit`, `time_limit`, `page_limit`, `chunk_limit`, `cancelled`, `read_failed` ou `capture_failed`. Falhas e interrupções retornam os blocos já armazenados e seu checkpoint, com `error.code` quando aplicável. Por isso, sucesso do nó n8n não implica saída completa: aceite sucesso apenas com `stop_reason = completed`, `output_drained = true` e `output_complete = true`.

Persista os blocos e o checkpoint juntos, antes de avançar. Na próxima chamada, mantenha Execution ID e envie os valores retornados em After Sequence, Expected Stdout Byte Offset e Expected Stderr Byte Offset. Cancelar a leitura não cancela o processo no agente; Cancel continua sendo uma operação explícita.

O checkpoint não é gravado automaticamente em armazenamento de negócio. Se o n8n encerrar à força ou descartar os resultados de uma execução cancelada, retome do último checkpoint efetivamente persistido pelo workflow. Leituras podem ser repetidas dentro da retenção; não refaça Run nem Send Input. As referências binárias seguem a retenção e a limpeza de dados da instalação n8n.

## Como agir quando o prazo da requisição expira

`ACTION_IO_REQUEST_EXPIRED` indica um problema com o prazo da requisição. Não comprova token expirado, diferença de relógio ou término do processo. A mensagem identifica a operação e orienta a verificar conexão, canal, filas, cancelamento e versões. A tolerância ao horário depende de suporte no servidor e no agente; versões antigas continuam exigindo relógios sincronizados. Aumentar o timeout não corrige uma conexão indisponível ou uma falha na negociação do prazo.

| Operação que falhou      | Próxima ação após corrigir a causa                                                            |
| ------------------------ | --------------------------------------------------------------------------------------------- |
| List Available Actions   | Repita somente a consulta ao catálogo; ela não inicia processos.                              |
| Validate Run             | Repita somente a validação. Prossiga para Run apenas se ela passar.                           |
| Run                      | Use Find Execution com Action ID e Idempotency Key originais antes de iniciar outro processo. |
| Send Input / Close Input | Consulte Get Input Status com Execution ID e Message ID originais; não duplique entrada.      |
| Read I/O                 | Retome do último checkpoint consumido, com o mesmo Execution ID, até o evento completed.      |
| Cancel                   | Consulte Get Execution; perder a resposta não confirma cancelamento.                          |

Os códigos técnicos e os indicadores de efeitos possíveis permanecem disponíveis para tratamento pelo workflow, inclusive com Continue On Fail. As mensagens não habilitam repetição automática nem substituem a confirmação do estado remoto.
