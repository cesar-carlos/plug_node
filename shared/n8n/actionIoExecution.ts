import {
  readAgentCredential,
  withAgentCredentialDiagnostics,
} from "./agentCredentialSource";
import type { IExecuteFunctions, INodeExecutionData, IDataObject } from "n8n-workflow";
import { loginClient } from "../auth/session";
import {
  ActionIoError,
  callActionIo,
  nextActionIoOffsets,
  type ActionIoTransport,
} from "../contracts/actionIo/client";
import {
  actionIoBlockSchema,
  ACTION_IO_BLOCK_BYTES,
  actionIoParamsSchemas,
} from "../contracts/actionIo/params";
import { createRestActionIoTransport } from "../rest/actionIoTransport";
import { isRecord } from "../utils/json";
import { buildApiUrl } from "../utils/url";
import { readPlugCredentials } from "./plugCommandRequestBuilder";
import { resolvePayloadFrameSigning } from "./payloadFrameSigning";
import { buildN8nHttpRequester } from "./httpRequester";
import { executePerInputItem } from "./plugItemExecution";
import type { PlugClientNodeExecutionConfig } from "./plugClientExecutionTypes";
import {
  actionIoOutputDrained,
  readAllActionIo,
  validateActionIoReadBudget,
} from "./actionIoReadAll";

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
  const format = context.getNodeParameter("actionInputFormat", index, "base64");
  if (format === "text") {
    const value = context.getNodeParameter("actionText", index, "");
    if (typeof value !== "string") throw new ActionIoError("INVALID_INPUT_TEXT", false);
    if (
      value.length > ACTION_IO_BLOCK_BYTES ||
      Buffer.byteLength(value, "utf8") > ACTION_IO_BLOCK_BYTES
    )
      throw new ActionIoError("INPUT_TOO_LARGE", false);
    if (/[\uD800-\uDFFF]/u.test(value))
      throw new ActionIoError("INVALID_INPUT_TEXT", false);
    return Buffer.from(value, "utf8").toString("base64");
  }
  if (format === "base64") {
    const value = context.getNodeParameter("actionBase64", index, "");
    if (!actionIoBlockSchema.safeParse(value).success)
      throw new ActionIoError("INVALID_INPUT_BLOCK", false);
    return value as string;
  }
  if (format !== "binary") throw new ActionIoError("INVALID_INPUT_FORMAT", false);
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
  const {
    agentId,
    clientToken: token,
    source,
  } = await readAgentCredential(
    context,
    hub,
    context.getNodeParameter("agentCredentialSource", 0, "separate"),
  );
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
        const selection = get("actionSelection", "manual");
        if (selection === "manual") params.action_id = get("actionId");
        else if (selection === "catalog") {
          const selected: unknown = context.getNodeParameter("actionCatalog", index, {});
          if (
            !isRecord(selected) ||
            selected.mode !== "list" ||
            typeof selected.value !== "string" ||
            !selected.value
          )
            throw new ActionIoError("MISSING_CATALOG_ACTION", false);
          params.action_id = selected.value;
        } else throw new ActionIoError("INVALID_ACTION_SELECTION", false);
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
      let offsets: { stdout: number; stderr: number } | undefined;
      if (operation === "readIo" || operation === "readAll") {
        offsets = {
          stdout: Number(get("actionStdoutOffset", 0)),
          stderr: Number(get("actionStderrOffset", 0)),
        };
        if (Object.values(offsets).some((n) => !Number.isSafeInteger(n) || n < 0))
          throw new ActionIoError("INVALID_CHECKPOINT", false);
        Object.assign(params, {
          after_sequence: get("actionAfterSequence", 0),
          max_bytes: get("actionMaxBytes", 262144),
          wait_ms: get("actionWaitMs", 20000),
        });
      }
      const budget =
        operation === "readAll"
          ? validateActionIoReadBudget(
              get("actionTotalBytes", 8388608),
              get("actionReadTimeout", 30000),
            )
          : undefined;
      if (budget && !actionIoParamsSchemas.readIo.safeParse(params).success)
        throw new ActionIoError("INVALID_CHECKPOINT", false);
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
      if (budget && offsets) {
        return readAllActionIo(
          context,
          index,
          params,
          offsets,
          budget,
          (readParams, signal) =>
            withAgentCredentialDiagnostics(source, () =>
              callActionIo(
                channel === "rest"
                  ? createRestActionIoTransport({
                      endpoint: buildApiUrl(hub.baseUrl, "/agents/commands"),
                      agentId,
                      bearerToken: () => session.accessToken,
                      signal,
                    })
                  : transport,
                "readIo",
                readParams,
                token,
              ),
            ),
          () => {
            transports.get(String(channel))?.dispose();
            transports.delete(String(channel));
          },
        );
      }
      const result = await withAgentCredentialDiagnostics(source, () =>
        callActionIo(transport, operation, params, token),
      );
      const item: INodeExecutionData = {
        json: result as IDataObject,
        pairedItem: { item: index },
      };
      if (offsets) {
        item.json = {
          ...item.json,
          next_offsets: nextActionIoOffsets(result, offsets),
          output_drained: actionIoOutputDrained(result),
        };
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
