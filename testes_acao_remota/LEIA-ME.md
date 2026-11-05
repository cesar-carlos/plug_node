# Teste manual de ação remota

Confere, a partir desta máquina, se o Hub aceitou `agent.action.run` de uma ação salva no agente e se o processo terminou com sucesso. O script no agente devolve o marcador e a identidade da máquina: nome, usuário, Windows, arquitetura, pid, hora local e caminho do arquivo. A chamada envia o texto de `echo` na entrada padrão e o script devolve a mesma linha em `PLUG_REMOTE_ECHO`. O chamador imprime esse stdout, lido por `agent.action.readIo`, e confirma que o valor enviado voltou.

Isto não liga produção e não envia comando livre. A entrada vai em `io.initial_input_base64`, com a entrada encerrada na mesma chamada. A consulta de estado usa `agent.action.getExecution` com `include_output: false`. Os bytes continuam no `readIo`.

Esta pasta fica na raiz do `plug_node` e não entra em `npm run test:e2e`. O E2E automatizado cobre SQL. Aqui o canal é o REST do Hub, o mesmo `POST /api/v1/agents/commands` que o nó usa quando **Channel** é **REST**.

## No agente

1. Copie `acao_no_agente.ps1` para um caminho fixo da máquina do agente, por exemplo `C:\PlugAcaoRemota\acao_no_agente.ps1`.
2. Crie uma ação do tipo **Script**.
3. Caminho do script: o arquivo copiado. Deixe o interpretador vazio. O agente usa `powershell.exe -NoProfile -ExecutionPolicy Bypass -File`.
4. Deixe a captura de stdout ligada e ligue **Permitir entrada e saída remota fiel**.
5. Ligue **Execução remota**, crie um gatilho remoto habilitado, salve e aprove.
6. Deixe **Ad-hoc remoto** desligado. Se a ação já tiver esse chip, a preferência de ad-hoc também precisa estar ligada.
7. Em Preferências, **Ações remotas e entrada/saída**, ligue **Permitir ações remotas** e **Permitir entrada/saída de processos**. Saia pela bandeja e abra o agente de novo.
8. Anote o `action_id`. Se houver mais de um gatilho remoto, anote também o `trigger_id`.

## Nesta máquina

1. Copie `config.example.json` para `config.local.json` nesta pasta.
2. Preencha `hubUrl`, o `agentId`, o `clientToken` da credencial local, o `actionId` e o `echo`. `hubUrl` aceita a origem do servidor ou a mesma base do `.env` (`PLUG_E2E_BASE_URL`, já com `/api/v1`). O script chama `/client-auth/login` e `/agents/commands` nessa API.
3. Informe `accessToken` ou o e-mail e a senha do Client que já tem acesso a esse agente. São os mesmos papéis de `PLUG_E2E_USER` e `PLUG_E2E_PASSWORD`, mas o token desta prova precisa dos escopos de ação. O token usado no E2E de SQL não autoriza esta chamada.
4. Na credencial local, preencha **Agent ID** com o identificador deste agente. O exemplo `agent-01` não vale. No **Payload JSON**, declare os escopos da entrada fiel. O botão **Incluir escopos de entrada fiel** grava os três escopos. `action_ids` é opcional e, quando presente, limita o token a essas ações. Salvar o payload rotaciona o token: copie o valor novo para `clientToken`. O `echo` é uma linha só. O exemplo usa `eco-remoto-ok`.

```json
{
  "agent_actions": {
    "scopes": ["agent_actions.validate_run", "agent_actions.run", "agent_actions.read_execution", "agent_actions.io"],
    "action_ids": ["cole-aqui-o-action-id"]
  }
}
```

Na raiz do repositório:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testes_acao_remota\chamar_daqui.ps1
```

O chamador retorna código 0 quando a ação termina em `succeeded`, o processo informa código 0 e a leitura chega a `output_complete = true` com a linha exata `PLUG_REMOTE_ECHO=<echo>`. A leitura verifica os offsets de stdout em bytes antes de decodificar o texto UTF-8. Se o eco chegar antes da última página, o teste ainda aguarda a confirmação de saída completa.

Só o preflight, sem iniciar processo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\testes_acao_remota\chamar_daqui.ps1 -SomenteValidar
```

`config.local.json` e `ultima_chamada.json` ficam de fora do Git. `ultima_chamada.json` guarda a chave de idempotência e o `execution_id` para consultar de novo se a resposta se perder. Não rode o script outra vez com outra chave nesse caso.
