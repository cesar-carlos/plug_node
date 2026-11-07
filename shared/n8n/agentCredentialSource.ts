import type { IExecuteFunctions } from "n8n-workflow";
import type { PlugCredentialDefaults } from "../contracts/api";
import { PlugError, PlugValidationError } from "../contracts/errors";

export type AgentCredentialSource = "account" | "separate";

const sourceDescription = (source: AgentCredentialSource): string =>
  source === "account"
    ? "Origem selecionada: Account Credential. Confira Default Agent ID e Default Client Token na credencial de conta."
    : "Origem selecionada: Separate Agent Credential. Confira Agent ID e Local Client Token na credencial Plug Agent API.";

/** Missing selection preserves the separate credential used by existing workflows. */
export const readAgentCredential = async (
  context: Pick<IExecuteFunctions, "getCredentials">,
  account: PlugCredentialDefaults,
  source: unknown = "separate",
): Promise<{ agentId: string; clientToken: string; source: AgentCredentialSource }> => {
  if (source !== "account" && source !== "separate")
    throw new PlugValidationError(
      "Select a valid Agent Credential Source: Account Credential or Separate Agent Credential.",
    );
  let credential: { agentId?: unknown; clientToken?: unknown };
  try {
    credential =
      source === "account" ? account : await context.getCredentials("plugAgentApi");
  } catch {
    throw new PlugValidationError(
      "Não foi possível carregar a credencial de agente selecionada.",
      {
        description:
          sourceDescription(source) +
          " Confira o vínculo e o acesso à credencial no n8n. Nenhuma outra credencial foi tentada.",
      },
    );
  }
  if (
    typeof credential.agentId !== "string" ||
    !credential.agentId.trim() ||
    typeof credential.clientToken !== "string" ||
    !credential.clientToken.trim()
  )
    throw new PlugValidationError(
      source === "account"
        ? "Set Default Agent ID and Default Client Token in the account credential. The token must be provisioned on the agent and allow the selected operation."
        : "Set Agent ID and Local Client Token in the separate Plug Agent API credential.",
      {
        description:
          sourceDescription(source) + " Nenhuma chamada ao Hub ou ao agente foi enviada.",
      },
    );
  return { agentId: credential.agentId, clientToken: credential.clientToken, source };
};

/** Add local configuration guidance without changing remote codes or outcome semantics. */
export const withAgentCredentialDiagnostics = async <T>(
  source: AgentCredentialSource,
  operation: () => Promise<T>,
): Promise<T> => {
  try {
    return await operation();
  } catch (error: unknown) {
    if (
      !(error instanceof PlugError) ||
      !(
        [
          "ACTION_IO_UNAUTHORIZED",
          "SQL_OPERATION_AUTHORIZATION_DENIED",
          "SQL_OPERATION_AUTHORIZATION_CHANGED",
        ].includes(error.code) || error.details?.reason === "scope_or_action_denied"
      )
    )
      throw error;
    throw new PlugError(error.message, {
      code: error.code,
      statusCode: error.statusCode,
      correlationId: error.correlationId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      authRelated: error.authRelated,
      details: error.details,
      description: [
        error.description,
        sourceDescription(source),
        "Confira os escopos e as ações permitidas no agente. O teste de conexão da conta valida apenas o login no Hub; nenhuma outra credencial foi tentada.",
      ]
        .filter(Boolean)
        .join(" "),
    });
  }
};
