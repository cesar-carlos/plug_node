import { Buffer } from "node:buffer";

import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import {
  addImageWatermark,
  compressImage,
  convertImage,
  createThumbnail,
  resizeImage,
} from "../tools/image";
import {
  plugToolAddImageWatermarkOperation,
  plugToolCompressImageOperation,
  plugToolConvertImageOperation,
  plugToolCreateThumbnailOperation,
  plugToolResizeImageOperation,
} from "./plugToolsDescription";
import {
  assertBufferSize,
  normalizePositiveIntegerLimit,
  normalizeOutputBinaryProperty,
  serializeErrorForContinueOnFail,
  toCollection,
  toNodeOperationError,
  type PlugToolsExecutionConfig,
} from "./plugToolsCommon";

type ImageOperation =
  | typeof plugToolResizeImageOperation
  | typeof plugToolConvertImageOperation
  | typeof plugToolCompressImageOperation
  | typeof plugToolAddImageWatermarkOperation
  | typeof plugToolCreateThumbnailOperation;

const executeTransform = async (
  operation: ImageOperation,
  buffer: Buffer,
  options: Record<string, unknown>,
) => {
  if (operation === plugToolResizeImageOperation) {
    return resizeImage(buffer, options);
  }
  if (operation === plugToolConvertImageOperation) {
    return convertImage(buffer, options);
  }
  if (operation === plugToolCompressImageOperation) {
    return compressImage(buffer, options);
  }
  if (operation === plugToolAddImageWatermarkOperation) {
    return addImageWatermark(buffer, {
      ...options,
      text: options.watermarkText,
      opacity: options.watermarkOpacity,
    });
  }

  return createThumbnail(buffer, options);
};

export const executePlugToolsImageNode = async (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
  operation: ImageOperation,
): Promise<INodeExecutionData[][]> => {
  const items = context.getInputData();
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const binaryPropertyName = context.getNodeParameter(
        "binaryPropertyName",
        itemIndex,
        "data",
      ) as string;
      const outputBinaryProperty = normalizeOutputBinaryProperty(
        context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
      );
      const options = toCollection(context, "imageOptions", itemIndex);
      const maxInputSizeBytes = normalizePositiveIntegerLimit(
        context.getNodeParameter("maxInputSizeBytes", itemIndex, 25_000_000),
        25_000_000,
        "Max Input Size Bytes",
      );
      const maxOutputSizeBytes = normalizePositiveIntegerLimit(
        options.maxOutputSizeBytes,
        25_000_000,
        "Max Output Size Bytes",
      );
      const input = await context.helpers.getBinaryDataBuffer(
        itemIndex,
        binaryPropertyName,
      );
      assertBufferSize(input, maxInputSizeBytes, "Image input");
      const output = await executeTransform(operation, input, options);
      if (output.buffer.length > maxOutputSizeBytes) {
        throw new Error(
          `Image output size must be less than or equal to ${maxOutputSizeBytes} bytes`,
        );
      }

      const binaryData = await context.helpers.prepareBinaryData(
        output.buffer,
        `image.${output.extension}`,
        output.mimeType,
      );
      outputItems.push({
        json: {
          ...items[itemIndex].json,
          __plugTools: {
            operation,
            width: output.width,
            height: output.height,
            mimeType: output.mimeType,
            sizeBytes: output.buffer.length,
            outputBinaryProperty,
          },
        },
        binary: {
          ...(items[itemIndex].binary ?? {}),
          [outputBinaryProperty]: binaryData,
        },
        pairedItem: { item: itemIndex },
      });
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            ...items[itemIndex].json,
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: { item: itemIndex },
        });
        continue;
      }

      throw toNodeOperationError(context, error, config.nodeDisplayName, itemIndex);
    }
  }

  return [outputItems];
};
