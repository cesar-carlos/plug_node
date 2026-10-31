import { randomUUID } from "node:crypto";
import { PlugError } from "../errors";
import { isRecord } from "../../utils/json";
import { actionIoErrorDetails } from "./errorDetails";
import { actionIoParamsSchemas } from "./params";
import { captureActionIoExpectation } from "./expectation";
import { isValidActionIoResponse } from "./results";
import { featureUnavailablePresentation } from "../featureAvailability";

export interface ActionIoCommand {
  readonly jsonrpc: "2.0";
  readonly id: string;
  readonly method: string;
  readonly params: Readonly<Record<string, unknown>>;
}
export type ActionIoTransport = (command: ActionIoCommand) => Promise<unknown>;
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
    const presentation =
      availability ??
      (operation === "listAvailable" &&
      (code === "ACTION_IO_UNAUTHORIZED" ||
        details.failure_code === "ACTION_IO_UNAUTHORIZED")
        ? {
            message: "O agente negou acesso ao catálogo de ações.",
            description:
              "Confira a validade da credencial local, o vínculo com o agente e as permissões agent_actions.list, agent_actions.run e agent_actions.io.",
          }
        : undefined);
    super(presentation?.message ?? `Plug command failed (${code}).`, {
      code,
      retryable: false,
      description:
        presentation?.description ??
        "Reconcile using the original action key, execution or message ID before any new mutation. Automatic replay is disabled.",
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
    if (error instanceof ActionIoError) throw error;
    throw new ActionIoError("TRANSPORT_UNCONFIRMED", mutation);
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
    throw new ActionIoError("INVALID_RESPONSE", mutation);
  }
  if (Object.prototype.hasOwnProperty.call(response, "error")) {
    if (
      !isRecord(response.error) ||
      typeof response.error.code !== "number" ||
      typeof response.error.message !== "string" ||
      (response.error.data !== undefined && !isRecord(response.error.data))
    )
      throw new ActionIoError("INVALID_RESPONSE", mutation);
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
  if (!isRecord(response.result)) throw new ActionIoError("INVALID_RESPONSE", mutation);
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
