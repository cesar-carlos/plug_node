import { randomUUID } from "node:crypto";
import { PlugError } from "../errors";
import { isRecord } from "../../utils/json";
import { actionIoErrorDetails } from "./errorDetails";
import { actionIoParamsSchemas } from "./params";
import { captureActionIoExpectation } from "./expectation";
import { isValidActionIoResponse } from "./results";
import { featureUnavailablePresentation } from "../featureAvailability";
import { actionIoDeadlinePresentation } from "./deadlinePresentation";

export interface ActionIoCommand {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}
export type ActionIoTransport = (command: ActionIoCommand) => Promise<unknown>;
// Unknown methods remain conservative when sharing the single-dispatch transports.
const readOnlyMethods = new Set([
  "agent.action.validateRun",
  "agent.action.listAvailable",
  "agent.action.getExecution",
  "agent.action.findExecution",
  "agent.action.readIo",
  "agent.action.getInputStatus",
  "agent.getHealth",
  "sql.operation.get",
  "sql.describeSource",
  "sql.describeSchema",
]);
export const commandMayHaveEffects = (method: string): boolean =>
  !readOnlyMethods.has(method);
// Only the selected transport may reuse the snapshot during synchronous dispatch.
const sending = new WeakMap<
  ActionIoCommand,
  { transport: ActionIoTransport; json: string; bytes: number }
>();
export const currentActionIoEncoding = (
  command: ActionIoCommand,
  transport: ActionIoTransport,
) => {
  const entry = sending.get(command);
  return entry?.transport === transport ? entry : undefined;
};
export const dispatchEncodedCommand = (
  transport: ActionIoTransport,
  command: ActionIoCommand,
  json: string,
  bytes: number,
): Promise<unknown> => {
  sending.set(command, { transport, json, bytes });
  try {
    return transport(command);
  } finally {
    sending.delete(command);
  }
};
const recoveryDescription = (operation?: string): string => {
  switch (operation) {
    case "agent.getHealth":
      return "Get Agent Health apenas consulta a saúde do agente; não inicia nem altera uma execução. Confira a configuração e a autorização da credencial local e repita somente essa consulta após corrigir a causa. A repetição automática está desativada.";
    case "listAvailable":
      return "A consulta ao catálogo não inicia uma ação remota. Verifique a conexão com o agente e tente novamente somente List Available Actions após corrigir a causa. A repetição automática está desativada.";
    case "validateRun":
      return "Validate Run apenas valida a solicitação; não inicia o processo. Após corrigir a causa, execute novamente somente Validate Run e prossiga para Run apenas se a validação passar. A repetição automática está desativada.";
    case "getExecution":
      return "Consulte novamente Get Execution com o mesmo Execution ID após corrigir a causa. Essa consulta não reinicia nem cancela o processo. A repetição automática está desativada.";
    case "findExecution":
      return "Consulte novamente Find Execution com o Action ID e a Idempotency Key originais. Não execute Run novamente para procurar um processo existente. A repetição automática está desativada.";
    case "getInputStatus":
      return "Consulte novamente Get Input Status com o Execution ID e Message ID originais. Não reenvie a entrada sem confirmar seu estado. A repetição automática está desativada.";
    case "run":
      return "Antes de executar Run novamente, use Find Execution com o Action ID e a Idempotency Key originais. Se encontrar a execução, consulte Get Execution e retome Read I/O do último checkpoint consumido. Não gere outra chave para tentar recuperar a mesma ação. A repetição automática está desativada.";
    case "sendInput":
    case "closeInput":
      return "Use Get Input Status com o Execution ID e Message ID originais para confirmar o recebimento antes de decidir sobre o envio. Preserve a sequência original e não duplique a entrada. A repetição automática está desativada.";
    case "readIo":
      return "Retome Read I/O com o mesmo Execution ID e o último checkpoint consumido: After Sequence e offsets em bytes de stdout e stderr. Leia até o evento completed e confirme output_complete sem falha nesse evento. Não execute Run novamente para recuperar a saída; a falha de leitura não confirma o término do processo.";
    case "cancel":
      return "Consulte Get Execution com o Execution ID original para confirmar o cancelamento. A perda da resposta não confirma que o processo terminou. A repetição automática está desativada.";
    default:
      return "Confira o estado usando a chave da ação, Execution ID ou Message ID original antes de repetir qualquer comando que altere a execução. A repetição automática está desativada.";
  }
};

const inputDescriptions: Readonly<Record<string, string>> = {
  INVALID_INPUT_TEXT:
    "Enter valid Unicode text in Input Text. UTF-8 encoding does not accept isolated surrogate code units.",
  INPUT_TOO_LARGE:
    "Each input block is limited to 64 KiB in decoded bytes. Accents and emoji can use multiple UTF-8 bytes; send larger input in ordered blocks.",
  INVALID_INPUT_FORMAT:
    "Select Text UTF-8, Base64 or n8n Binary. Base64 input must already be encoded.",
  MISSING_CATALOG_ACTION:
    "Select an Authorized Action, or choose Enter ID or Expression and provide the Action ID. No fallback to the hidden ID is performed.",
  INVALID_ACTION_SELECTION:
    "Choose Enter ID or Expression, or Select From Authorized Catalog.",
};

export class ActionIoError extends PlugError {
  constructor(
    code: string,
    outcomeUnknown: boolean,
    details: Record<string, unknown> = {},
    operation?: string,
  ) {
    code = /^[A-Za-z0-9_.:-]{1,128}$/.test(code) ? code : "REMOTE_ERROR";
    const availability = featureUnavailablePresentation(code, details);
    if (availability?.methodNotExecuted) outcomeUnknown = false;
    let presentation: { message: string; description: string } | undefined = availability;
    presentation ??= actionIoDeadlinePresentation(
      code,
      details,
      operation,
      recoveryDescription(operation),
    );
    if (
      !presentation &&
      (code === "ACTION_IO_UNAUTHORIZED" ||
        details.failure_code === "ACTION_IO_UNAUTHORIZED")
    ) {
      if (operation === "listAvailable") {
        presentation = {
          message: "O agente negou acesso ao catálogo de ações.",
          description:
            "Confira a validade da credencial local, o vínculo com o agente e as permissões agent_actions.list, agent_actions.run e agent_actions.io.",
        };
      } else if (
        operation === "validateRun" &&
        details.reason === "scope_or_action_denied"
      ) {
        presentation = {
          message: "O agente negou a validação da ação.",
          description:
            "Confira se a credencial local permite esta ação e inclui os escopos agent_actions.validate_run e agent_actions.io.",
        };
      }
    }
    if (!presentation && operation === "validateRun" && code === "NOT_FOUND") {
      presentation = {
        message: "Recurso não encontrado ao validar a ação (NOT_FOUND).",
        description:
          "Confira o Agent ID da credencial selecionada em Agent Credential Source, o Action ID e, se informado, o Trigger ID nesse agente. O preflight não inicia o processo.",
      };
    }
    if (!presentation && operation === "listAvailable" && code === "NOT_FOUND") {
      presentation = {
        message: "Recurso não encontrado ao consultar o catálogo (NOT_FOUND).",
        description:
          "Confira o Agent ID, o vínculo e a validade da credencial local e a disponibilidade do catálogo nesse agente. O código sozinho não identifica o recurso ausente. A consulta não inicia uma ação; repita somente List Available Actions após corrigir a causa.",
      };
    }
    super(presentation?.message ?? `Plug command failed (${code}).`, {
      code,
      retryable: false,
      description:
        presentation?.description ??
        inputDescriptions[code] ??
        recoveryDescription(operation),
      details: {
        ...actionIoErrorDetails(details),
        outcome_unknown: outcomeUnknown,
        effects_possible: outcomeUnknown,
        retryable: false,
      },
    });
  }
}

/** One call, one dispatch. Caller owns durable keys, receipts and cursors. */
export const callActionIo = async (
  transport: ActionIoTransport,
  operation: string,
  params: Record<string, unknown>,
  credential: string,
): Promise<Record<string, unknown>> => {
  if (!Object.prototype.hasOwnProperty.call(actionIoParamsSchemas, operation))
    throw new ActionIoError("INVALID_REQUEST", false);
  const schema = actionIoParamsSchemas[operation];
  if (
    credential.length > 65536 ||
    Object.values(params).some(
      (value) => typeof value === "string" && value.length > 524288,
    )
  )
    throw new ActionIoError("REQUEST_TOO_LARGE", false);
  const identities = [
    "action_id",
    "idempotency_key",
    "trigger_id",
    "execution_id",
    "message_id",
  ];
  if (
    identities.some(
      (key) =>
        key in params &&
        (typeof params[key] !== "string" ||
          params[key] !== (params[key] as string).trim() ||
          !(params[key] as string).length),
    )
  )
    throw new ActionIoError("NON_CANONICAL_IDENTITY", false);
  const validated = schema?.safeParse(params);
  if (
    !credential ||
    !validated?.success ||
    !isRecord(validated.data) ||
    ((operation === "run" || operation === "validateRun") && !isRecord(validated.data.io))
  ) {
    throw new ActionIoError("INVALID_REQUEST", false);
  }
  const command: ActionIoCommand = {
    jsonrpc: "2.0",
    id: randomUUID(),
    method: `agent.action.${operation}`,
    params: { ...validated.data, client_token: credential },
  };
  const json = JSON.stringify(command);
  const bytes = Buffer.byteLength(json);
  if (bytes > 524288) throw new ActionIoError("REQUEST_TOO_LARGE", false);
  const mutation = ["run", "sendInput", "closeInput", "cancel"].includes(operation);
  let response: unknown;
  try {
    response = await dispatchEncodedCommand(transport, command, json, bytes);
  } catch (error) {
    if (error instanceof ActionIoError) {
      throw new ActionIoError(
        error.code,
        operation === "validateRun" ? false : error.details?.outcome_unknown === true,
        error.details,
        operation,
      );
    }
    throw new ActionIoError("TRANSPORT_UNCONFIRMED", mutation, {}, operation);
  }
  if (
    !isRecord(response) ||
    response.jsonrpc !== "2.0" ||
    response.id !== command.id ||
    !isValidActionIoResponse(command.method, response, {
      ...captureActionIoExpectation(command),
      faithfulIo: true,
    })
  ) {
    throw new ActionIoError("INVALID_RESPONSE", mutation, {}, operation);
  }
  if (Object.prototype.hasOwnProperty.call(response, "error")) {
    if (
      !isRecord(response.error) ||
      typeof response.error.code !== "number" ||
      typeof response.error.message !== "string" ||
      (response.error.data !== undefined && !isRecord(response.error.data))
    )
      throw new ActionIoError("INVALID_RESPONSE", mutation, {}, operation);
    const details = actionIoErrorDetails(response.error.data);
    throw new ActionIoError(
      String(details.code ?? details.failure_code ?? `RPC_${response.error.code}`),
      details.effects_possible === true ||
        details.outcome_unknown === true ||
        (mutation && details.effects_possible !== false),
      { ...details, rpc_code: response.error.code },
      operation,
    );
  }
  if (!isRecord(response.result))
    throw new ActionIoError("INVALID_RESPONSE", mutation, {}, operation);
  return response.result;
};

/** Check continuity against caller-persisted offsets without mutating its checkpoint. */
export const nextActionIoOffsets = (
  result: Record<string, unknown>,
  offsets: { stdout: number; stderr: number },
): { stdout: number; stderr: number } => {
  const next = { ...offsets };
  if (!Array.isArray(result.events)) throw new ActionIoError("INVALID_RESPONSE", false);
  for (const event of result.events) {
    if (!isRecord(event) || event.type !== "output") continue;
    const stream = event.stream;
    if (
      (stream !== "stdout" && stream !== "stderr") ||
      event.offset !== next[stream] ||
      typeof event.data_base64 !== "string"
    )
      throw new ActionIoError("OUTPUT_OFFSET_MISMATCH", false);
    next[stream] += Buffer.byteLength(event.data_base64, "base64");
    if (!Number.isSafeInteger(next[stream]))
      throw new ActionIoError("OUTPUT_OFFSET_MISMATCH", false);
  }
  return next;
};
