import type { ILoadOptionsFunctions, INodeListSearchResult } from "n8n-workflow";
import { loginClient } from "../auth/session";
import { callActionIo, type ActionIoTransport } from "../contracts/actionIo/client";
import { PlugValidationError } from "../contracts/errors";
import { createRestActionIoTransport } from "../rest/actionIoTransport";
import { buildApiUrl } from "../utils/url";
import { isRecord } from "../utils/json";
import { readPlugCredentials } from "./plugCommandRequestBuilder";
import {
  readAgentCredential,
  withAgentCredentialDiagnostics,
} from "./agentCredentialSource";
import { buildN8nHttpRequester } from "./httpRequester";
import { resolvePayloadFrameSigning } from "./payloadFrameSigning";
import type { ActionIoTransportFactory } from "./actionIoExecution";

/** One request per dropdown page; no token cache, retries or action execution. */
export const getAuthorizedActions = async (
  context: ILoadOptionsFunctions,
  factory: ActionIoTransportFactory,
  paginationToken?: string,
): Promise<INodeListSearchResult> => {
  const channel = context.getNodeParameter("actionChannel", "rest");
  if (!["rest", "socket", "relay"].includes(String(channel)))
    throw new PlugValidationError("Select a supported catalog channel.");
  if (
    paginationToken !== undefined &&
    (typeof paginationToken !== "string" || paginationToken.length > 128)
  )
    throw new PlugValidationError("Invalid catalog cursor. Reload the first page.");
  const account = await readPlugCredentials(context);
  const { agentId, clientToken, source } = await readAgentCredential(
    context,
    account,
    context.getNodeParameter("agentCredentialSource", "separate"),
  );
  const session = await loginClient(buildN8nHttpRequester(context), account);
  let connection: Awaited<ReturnType<ActionIoTransportFactory>> | undefined;
  try {
    const transport: ActionIoTransport =
      channel === "rest"
        ? createRestActionIoTransport({
            endpoint: buildApiUrl(account.baseUrl, "/agents/commands"),
            agentId,
            bearerToken: () => session.accessToken,
          })
        : (connection = await factory({
            baseUrl: account.baseUrl,
            accessToken: session.accessToken,
            agentId,
            relay: channel === "relay",
            signing: resolvePayloadFrameSigning(account),
          }));
    const result = await withAgentCredentialDiagnostics(source, () =>
      callActionIo(
        transport,
        "listAvailable",
        { page_size: 50, ...(paginationToken ? { cursor: paginationToken } : {}) },
        clientToken,
      ),
    );
    const actions = Array.isArray(result.actions) ? result.actions : [];
    return {
      results: actions.filter(isRecord).map((action) => ({
        name: `${action.name} (${action.action_id})`,
        value: String(action.action_id),
        description: action.io_eligible
          ? "Available for Action I/O; Validate Run before starting"
          : "Not eligible for Action I/O; review the action configuration",
      })),
      ...(typeof result.next_cursor === "string"
        ? { paginationToken: result.next_cursor }
        : {}),
    };
  } finally {
    connection?.dispose();
  }
};
