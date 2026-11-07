const operationNames: Readonly<Record<string, string>> = {
  listAvailable: "da consulta ao catálogo de ações",
  validateRun: "da validação da ação",
  run: "da solicitação para iniciar a ação",
  sendInput: "do envio de entrada",
  closeInput: "do fechamento da entrada",
  readIo: "da leitura da saída",
  getExecution: "da consulta à execução",
  findExecution: "da busca da execução",
  getInputStatus: "da consulta ao recebimento da entrada",
  cancel: "da solicitação de cancelamento",
};

/** Explain request expiry without inferring token expiry or process termination. */
export const actionIoDeadlinePresentation = (
  code: string,
  details: Readonly<Record<string, unknown>>,
  operation: string | undefined,
  recovery: string,
): { message: string; description: string } | undefined => {
  if (
    code !== "ACTION_IO_REQUEST_EXPIRED" &&
    details.failure_code !== "ACTION_IO_REQUEST_EXPIRED"
  )
    return undefined;

  const diagnosis =
    "1. Confirme que o plug_agente está online e que o canal selecionado consegue alcançá-lo. Verifique lentidão, filas e se a requisição foi cancelada. " +
    "2. Confira as versões do plug_server e do plug_agente. A tolerância à diferença de horário exige suporte nas duas pontas; com versões antigas, verifique a sincronização dos relógios. O erro sozinho não confirma essa causa nem indica token expirado. Não aumente o timeout como primeira medida: isso não corrige falhas de conexão ou de negociação do prazo. ";
  const readOnly = [
    "listAvailable",
    "validateRun",
    "readIo",
    "getExecution",
    "findExecution",
    "getInputStatus",
  ].includes(operation ?? "");
  const effects = readOnly
    ? ""
    : "A expiração da requisição não confirma se o processo iniciou ou terminou, nem se a entrada foi entregue. ";
  return {
    message: `O prazo ${operationNames[operation ?? ""] ?? "da requisição de ação remota"} expirou (ACTION_IO_REQUEST_EXPIRED).`,
    description: `${diagnosis}3. ${effects}${recovery}`,
  };
};
