import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import {
  generateBarcode,
  normalizeBarcodeFileName,
  normalizeBarcodeOutputProperty,
  resolveBarcodeRenderInput,
} from "../tools/barcode";
import { plugToolGenerateBarcodeOperation } from "./plugToolsDescription";
import {
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  now,
  parseAdvancedOptions,
  toCollection,
  toNodeOperationError,
  type PlugToolsBarcodeExecutionConfig,
} from "./plugToolsCommon";
import { executePerInputItem } from "./plugItemExecution";

export const executePlugToolsBarcodeNode = async (
  context: IExecuteFunctions,
  config: PlugToolsBarcodeExecutionConfig,
): Promise<INodeExecutionData[][]> =>
  executePerInputItem(
    context,
    async (itemIndex, item) => {
      const renderOptions = toCollection(context, "renderOptions", itemIndex);
      const barcode = resolveBarcodeRenderInput({
        text: context.getNodeParameter("text", itemIndex),
        barcodeType: context.getNodeParameter("barcodeType", itemIndex, "qrcode"),
        outputFormat: context.getNodeParameter("outputFormat", itemIndex, "png"),
        renderOptions: {
          scale: renderOptions.scale,
          height: renderOptions.height,
          maxTextSizeBytes: renderOptions.maxTextSizeBytes,
          maxOutputSizeBytes: renderOptions.maxOutputSizeBytes,
          includeText: renderOptions.includeText,
          textXAlign: renderOptions.textXAlign,
          qrErrorCorrection: renderOptions.qrErrorCorrection,
          foregroundColor: renderOptions.foregroundColor,
          backgroundColor: renderOptions.backgroundColor,
        },
        advancedOptions: parseAdvancedOptions(
          context.getNodeParameter("advancedOptionsJson", itemIndex, "{}"),
        ),
      });
      const outputBinaryProperty = normalizeOutputBinaryProperty(
        normalizeBarcodeOutputProperty(
          context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
        ),
      );
      const fileName = normalizeBarcodeFileName(
        context.getNodeParameter("fileName", itemIndex, "barcode"),
        barcode.outputFormat,
      );
      const includeMetadata = context.getNodeParameter(
        "includePlugToolsMetadata",
        itemIndex,
        true,
      ) as boolean;
      const includeBase64Json = context.getNodeParameter(
        "includeBase64Json",
        itemIndex,
        false,
      ) as boolean;
      const metadataProperty = includeMetadata
        ? normalizeOutputJsonProperty(
            context.getNodeParameter("metadataProperty", itemIndex, "__plugTools"),
            "__plugTools",
            "Metadata Property",
          )
        : undefined;
      const base64OutputProperty = includeBase64Json
        ? normalizeOutputJsonProperty(
            context.getNodeParameter(
              "base64OutputProperty",
              itemIndex,
              "generatedCodeBase64",
            ),
            "generatedCodeBase64",
            "Base64 Output Property",
          )
        : undefined;
      const startedAt = now();
      const generated = await generateBarcode(barcode);
      const durationMs = now() - startedAt;
      const binaryData = await context.helpers.prepareBinaryData(
        generated.buffer,
        fileName,
        generated.mimeType,
      );

      return {
        json: {
          ...item.json,
          ...(includeMetadata
            ? {
                [metadataProperty ?? "__plugTools"]: {
                  operation: plugToolGenerateBarcodeOperation,
                  barcodeType: barcode.barcodeType,
                  outputFormat: barcode.outputFormat,
                  fileName,
                  mimeType: generated.mimeType,
                  sizeBytes: generated.buffer.length,
                  durationMs,
                  outputBinaryProperty,
                },
              }
            : {}),
          ...(includeBase64Json
            ? {
                [base64OutputProperty ?? "generatedCodeBase64"]:
                  generated.buffer.toString("base64"),
              }
            : {}),
        },
        binary: {
          ...(item.binary ?? {}),
          [outputBinaryProperty]: binaryData,
        },
        pairedItem: {
          item: itemIndex,
        },
      };
    },
    {
      onError: (error, itemIndex) =>
        toNodeOperationError(context, error, config.nodeDisplayName, itemIndex),
    },
  );
