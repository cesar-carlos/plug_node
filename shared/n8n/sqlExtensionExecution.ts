import type { IExecuteFunctions, INodeExecutionData, IDataObject } from "n8n-workflow";
import { loginClient } from "../auth/session";
import { ActionIoError, type ActionIoTransport } from "../contracts/actionIo/client";
import { callSqlExtension } from "../contracts/sqlOperation/client";
import { createRestActionIoTransport } from "../rest/actionIoTransport";
import { buildApiUrl } from "../utils/url";
import { isRecord } from "../utils/json";
import { readPlugCredentials } from "./plugCommandRequestBuilder";
import { buildN8nHttpRequester } from "./httpRequester";
import { resolvePayloadFrameSigning } from "./payloadFrameSigning";
import { executePerInputItem } from "./plugItemExecution";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";

export const executeSqlExtensionNode = async (
  context: IExecuteFunctions,
  config: PlugClientNodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  if (context.getNode().retryOnFail) throw new ActionIoError("DISABLE_NODE_RETRY", false);
  const hub = await readPlugCredentials(context, config.credentialName);
  const agent = await context.getCredentials("plugAgentApi");
  if (
    typeof agent.agentId !== "string" ||
    !agent.agentId ||
    typeof agent.clientToken !== "string" ||
    !agent.clientToken
  )
    throw new ActionIoError("MISSING_AGENT_CREDENTIAL", false);
  const agentId = agent.agentId;
  const token = agent.clientToken;
  const session = await loginClient(buildN8nHttpRequester(context), hub);
  const transports = new Map<string, ActionIoTransport & { dispose(): void }>();
  try {
    return await executePerInputItem(context, async (index) => {
      const method = String(context.getNodeParameter("operation", index));
      const raw =
        method === "agent.getHealth"
          ? "{}"
          : context.getNodeParameter("extensionParams", index, "{}");
      if (
        typeof raw !== "string" ||
        raw.length > 2097152 ||
        Buffer.byteLength(raw) > 2097152
      )
        throw new ActionIoError("INVALID_REQUEST", false);
      let params: unknown;
      try {
        params = JSON.parse(raw);
      } catch {
        throw new ActionIoError("INVALID_REQUEST", false);
      }
      if (!isRecord(params)) throw new ActionIoError("INVALID_REQUEST", false);
      const channel = String(context.getNodeParameter("actionChannel", index, "rest"));
      let transport: ActionIoTransport;
      if (channel === "rest")
        transport = createRestActionIoTransport({
          endpoint: buildApiUrl(hub.baseUrl, "/agents/commands"),
          agentId,
          bearerToken: () => session.accessToken,
          maxResponseBytes: 4 * 1024 * 1024,
        });
      else {
        if (!config.actionIoTransportFactory || !["socket", "relay"].includes(channel))
          throw new ActionIoError("UNSUPPORTED_CHANNEL", false);
        let socket = transports.get(channel);
        if (!socket) {
          socket = await config.actionIoTransportFactory({
            baseUrl: hub.baseUrl,
            accessToken: session.accessToken,
            agentId,
            relay: channel === "relay",
            signing: resolvePayloadFrameSigning(hub),
            maxRequestBytes: 3 * 1024 * 1024,
            maxResponseBytes: 4 * 1024 * 1024,
          });
          transports.set(channel, socket);
        }
        transport = socket;
      }
      return {
        json: (await callSqlExtension(transport, method, params, token)) as IDataObject,
        pairedItem: { item: index },
      };
    });
  } finally {
    for (const transport of transports.values()) transport.dispose();
  }
};
