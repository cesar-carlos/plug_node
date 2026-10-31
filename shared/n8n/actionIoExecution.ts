import type { IExecuteFunctions, INodeExecutionData, IDataObject } from "n8n-workflow";
import { loginClient } from "../auth/session";
import {
  ActionIoError,
  callActionIo,
  nextActionIoOffsets,
  type ActionIoTransport,
} from "../contracts/actionIo/client";
import { actionIoBlockSchema } from "../contracts/actionIo/params";
import { createRestActionIoTransport } from "../rest/actionIoTransport";
import { isRecord } from "../utils/json";
import { buildApiUrl } from "../utils/url";
import { readPlugCredentials } from "./plugCommandRequestBuilder";
import { resolvePayloadFrameSigning } from "./payloadFrameSigning";
import { buildN8nHttpRequester } from "./httpRequester";
import { executePerInputItem } from "./plugItemExecution";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";

export interface ActionIoTransportFactory {
  (input: {
    baseUrl: string;
    accessToken: string;
    agentId: string;
    relay: boolean;
    maxRequestBytes?: number;
    maxResponseBytes?: number;
    signing?: import("../contracts/payload-frame").PayloadFrameSigningOptions;
  }): Promise<ActionIoTransport & { dispose(): void }>;
}
const readInput = async (context: IExecuteFunctions, index: number): Promise<string> => {
  if (context.getNodeParameter("actionInputFormat", index, "base64") === "base64") {
    const value = context.getNodeParameter("actionBase64", index, "");
    if (!actionIoBlockSchema.safeParse(value).success)
      throw new ActionIoError("INVALID_INPUT_BLOCK", false);
    return value as string;
  }
  const field = String(context.getNodeParameter("actionBinaryField", index, "data"));
  const binary = context.helpers.assertBinaryData(index, field);
  if (!binary.id) {
    if (!actionIoBlockSchema.safeParse(binary.data).success)
      throw new ActionIoError("INVALID_INPUT_BLOCK", false);
    return binary.data;
  }
  const stream = await context.helpers.getBinaryStream(binary.id, 65536);
  const blocks: Buffer[] = [];
  let bytes = 0;
  try {
    for await (const block of stream) {
      if (!(block instanceof Uint8Array) || bytes + block.byteLength > 65536)
        throw new ActionIoError("INPUT_TOO_LARGE", false);
      bytes += block.byteLength;
      blocks.push(Buffer.from(block));
    }
  } finally {
    stream.destroy();
  }
  return Buffer.concat(blocks, bytes).toString("base64");
};

export const executeActionIoNode = async (
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
  // Login is completed before dispatch; no session callback can replay a command.
  const session = await loginClient(buildN8nHttpRequester(context), hub);
  const transports = new Map<string, ActionIoTransport & { dispose(): void }>();
  try {
    return await executePerInputItem(context, async (index) => {
      const operation = String(context.getNodeParameter("operation", index));
      const get = (
        name: string,
        fallback: string | number | boolean = "",
      ): string | number | boolean =>
        context.getNodeParameter(name, index, fallback) as string | number | boolean;
      const params: Record<string, unknown> = {};
      if (["run", "validateRun", "findExecution"].includes(operation)) {
        params.action_id = get("actionId");
        params.idempotency_key = get("actionKey");
      } else if (operation === "listAvailable") {
        params.page_size = get("catalogPageSize", 20);
        const cursor = get("catalogCursor");
        if (cursor !== "") params.cursor = cursor;
      } else params.execution_id = get("actionExecutionId");
      if (["run", "validateRun"].includes(operation)) {
        const trigger = get("actionTrigger");
        if (trigger) params.trigger_id = trigger;
        params.io = {
          version: 1,
          mode: "faithful",
          close_input: get("actionClose", false),
          ...(get("actionInitial", false)
            ? { initial_input_base64: await readInput(context, index) }
            : {}),
        };
      }
      if (["sendInput", "closeInput", "getInputStatus"].includes(operation))
        params.message_id = get("actionMessageId");
      if (["sendInput", "closeInput"].includes(operation))
        params.sequence = get("actionSequence", 0);
      if (operation === "sendInput") params.data_base64 = await readInput(context, index);
      if (operation === "getExecution") params.include_output = false;
      if (operation === "readIo")
        Object.assign(params, {
          after_sequence: get("actionAfterSequence", 0),
          max_bytes: get("actionMaxBytes", 262144),
          wait_ms: get("actionWaitMs", 20000),
        });
      const channel = get("actionChannel", "rest");
      let transport: ActionIoTransport;
      if (channel === "rest")
        transport = createRestActionIoTransport({
          endpoint: buildApiUrl(hub.baseUrl, "/agents/commands"),
          agentId,
          bearerToken: () => session.accessToken,
        });
      else {
        if (
          !config.actionIoTransportFactory ||
          (channel !== "socket" && channel !== "relay")
        )
          throw new ActionIoError("UNSUPPORTED_CHANNEL", false);
        let socket = transports.get(channel);
        if (!socket) {
          socket = await config.actionIoTransportFactory({
            baseUrl: hub.baseUrl,
            accessToken: session.accessToken,
            agentId,
            relay: channel === "relay",
            signing: resolvePayloadFrameSigning(hub),
          });
          transports.set(channel, socket);
        }
        transport = socket;
      }
      const result = await callActionIo(transport, operation, params, token);
      const item: INodeExecutionData = {
        json: result as IDataObject,
        pairedItem: { item: index },
      };
      if (operation === "readIo") {
        const offsets = {
          stdout: Number(get("actionStdoutOffset", 0)),
          stderr: Number(get("actionStderrOffset", 0)),
        };
        if (Object.values(offsets).some((n) => !Number.isSafeInteger(n) || n < 0))
          throw new ActionIoError("INVALID_CHECKPOINT", false);
        item.json = { ...item.json, next_offsets: nextActionIoOffsets(result, offsets) };
        item.binary = {};
        for (const event of result.events as unknown[]) {
          if (
            isRecord(event) &&
            event.type === "output" &&
            typeof event.data_base64 === "string"
          ) {
            item.binary[`event_${event.sequence}`] =
              await context.helpers.prepareBinaryData(
                Buffer.from(event.data_base64, "base64"),
                `${event.stream}-${event.offset}.bin`,
                "application/octet-stream",
              );
          }
        }
      }
      return item;
    });
  } finally {
    for (const transport of transports.values()) transport.dispose();
  }
};
