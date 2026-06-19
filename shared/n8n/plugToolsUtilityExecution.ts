import { Buffer } from "node:buffer";

import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { plugToolBase64Operation } from "./plugToolsDescription";
import {
  assertBufferSize,
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  normalizePositiveIntegerLimit,
  toNodeOperationError,
  type PlugToolsExecutionConfig,
} from "./plugToolsCommon";
import { base64DecodeToBuffer } from "../tools/security";
import { executePerInputItem } from "./plugItemExecution";
import {
  executeUtilityOperation,
  type UtilityOperation,
} from "./plugToolsUtilityHandlers";

const executeBase64BinaryDecode = async (
  context: IExecuteFunctions,
  item: INodeExecutionData,
  itemIndex: number,
  operation: typeof plugToolBase64Operation,
): Promise<INodeExecutionData> => {
  const maxInputSizeBytes = normalizePositiveIntegerLimit(
    context.getNodeParameter("maxInputSizeBytes", itemIndex, 25_000_000),
    25_000_000,
    "Max Input Size Bytes",
  );
  const text = context.getNodeParameter("text", itemIndex, "") as string;
  assertBufferSize(Buffer.from(text, "utf8"), maxInputSizeBytes, "Base64 input");
  const outputBinaryProperty = normalizeOutputBinaryProperty(
    context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
  );
  const buffer = base64DecodeToBuffer(text);
  const binaryData = await context.helpers.prepareBinaryData(
    buffer,
    "decoded.bin",
    "application/octet-stream",
  );

  return {
    json: {
      ...item.json,
      __plugTools: {
        operation,
        mode: "decode",
        outputBinaryProperty,
        sizeBytes: buffer.length,
      },
    },
    binary: {
      ...(item.binary ?? {}),
      [outputBinaryProperty]: binaryData,
    },
    pairedItem: { item: itemIndex },
  };
};

export const executePlugToolsUtilityNode = async (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
  operation: UtilityOperation,
): Promise<INodeExecutionData[][]> =>
  executePerInputItem(
    context,
    async (itemIndex, item) => {
      if (
        operation === plugToolBase64Operation &&
        context.getNodeParameter("base64Mode", itemIndex, "encode") === "decode" &&
        context.getNodeParameter("base64DecodeOutput", itemIndex, "text") === "binary"
      ) {
        return executeBase64BinaryDecode(context, item, itemIndex, operation);
      }

      const outputJsonProperty = normalizeOutputJsonProperty(
        context.getNodeParameter("outputJsonProperty", itemIndex, "result"),
        "result",
        "Output JSON Property",
      );
      const result = await executeUtilityOperation(context, itemIndex, operation);

      return {
        json: {
          ...item.json,
          [outputJsonProperty]: result,
          __plugTools: { operation },
        } as INodeExecutionData["json"],
        binary: item.binary,
        pairedItem: { item: itemIndex },
      };
    },
    {
      onError: (error, itemIndex) =>
        toNodeOperationError(context, error, config.nodeDisplayName, itemIndex),
    },
  );
