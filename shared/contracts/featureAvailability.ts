import { PlugError } from "./errors";
import { actionIoErrorDetails } from "./actionIo/errorDetails";

export interface FeatureUnavailablePresentation {
  readonly message: string;
  readonly description: string;
  readonly methodNotExecuted: boolean;
}

/** Only structured codes classify availability. Native error prose is never evidence. */
export const featureUnavailablePresentation = (
  code: string | number,
  details: unknown,
): FeatureUnavailablePresentation | undefined => {
  const safe = actionIoErrorDetails(details);
  const codes = [code, safe.code, safe.failure_code, safe.failureCode, safe.reason]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toUpperCase());
  const has = (...values: string[]): boolean =>
    codes.some((value) => values.includes(value));
  const methodNotExecuted =
    code === -32601 || code === "RPC_-32601" || safe.rpc_code === -32601;
  let message: string;
  if (
    methodNotExecuted ||
    has("METHOD_NOT_FOUND", "METHOD_NOT_IMPLEMENTED", "NOT_IMPLEMENTED")
  ) {
    message =
      "O método solicitado não está implementado ou não é reconhecido pelo destino.";
  } else if (
    has(
      "FEATURE_DISABLED",
      "DISABLED",
      "RESOURCE_DISABLED",
      "CAPABILITY_DISABLED",
      "HUB_FEATURE_DISABLED",
      "AGENT_FEATURE_DISABLED",
    )
  ) {
    message = "O recurso solicitado está desativado no Hub ou no agente.";
  } else if (
    has(
      "VERSION_INCOMPATIBLE",
      "INCOMPATIBLE",
      "INCOMPATIBLE_VERSION",
      "UNSUPPORTED_VERSION",
      "PROTOCOL_VERSION_UNSUPPORTED",
      "CAPABILITY_VERSION_MISMATCH",
      "CAPABILITY_VERSION_INCOMPATIBLE",
      "CONTRACT_VERSION_UNSUPPORTED",
    )
  ) {
    message =
      "A versão do recurso solicitado é incompatível com o contrato disponível no destino.";
  } else if (
    has(
      "CAPABILITY_UNAVAILABLE",
      "CAPABILITY_NOT_NEGOTIATED",
      "CAPABILITY_MISSING",
      "FEATURE_UNAVAILABLE",
      "RESOURCE_UNAVAILABLE",
    )
  ) {
    message =
      "O recurso solicitado está indisponível ou não foi negociado entre o Hub e o agente.";
  } else return undefined;
  const knownUnsent =
    methodNotExecuted ||
    (safe.effects_possible === false && safe.outcome_unknown !== true);
  return {
    message,
    methodNotExecuted,
    description:
      "Confira os recursos anunciados, a configuração e as versões compatíveis do Hub e do agente. A ausência de um recurso não comprova que o agente esteja desatualizado. " +
      (knownUnsent
        ? "Esta resposta indica que o método não foi executado. "
        : "Esta resposta não confirma a ausência de efeitos; consulte a execução pela identidade original quando aplicável. ") +
      "Não há repetição automática nem troca automática de transporte.",
  };
};

export const createFeatureUnavailableError = (
  code: string,
  details: unknown,
  context: { statusCode?: number; correlationId?: string } = {},
): PlugError | undefined => {
  const presentation = featureUnavailablePresentation(code, details);
  if (!presentation) return undefined;
  const safe = actionIoErrorDetails(details);
  const unknown = presentation.methodNotExecuted
    ? false
    : safe.effects_possible !== false || safe.outcome_unknown === true;
  return new PlugError(presentation.message, {
    code,
    ...context,
    retryable: false,
    description: presentation.description,
    details: {
      ...safe,
      ...(presentation.methodNotExecuted ? { rpc_code: -32601 } : {}),
      effects_possible: unknown,
      outcome_unknown: unknown,
      retryable: false,
    },
  });
};
