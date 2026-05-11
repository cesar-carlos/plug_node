import type { IDataObject, IExecuteFunctions, INodeExecutionData } from "n8n-workflow";
import { NodeOperationError } from "n8n-workflow";

import { PlugError, PlugValidationError } from "../contracts/errors";
import {
  generateBarcode,
  normalizeBarcodeFileName,
  normalizeBarcodeOutputProperty,
  resolveBarcodeRenderInput,
} from "../tools/barcode";
import {
  createPlaywrightHtmlToPdfRenderer,
  normalizeHtmlDocument,
  normalizePdfFileName,
  resolvePdfBrowserLaunchOptions,
  resolvePdfRenderOptions,
  type HtmlToPdfRenderer,
} from "../tools/pdf";
import { isRecord, parseJsonText } from "../utils/json";

export interface PlugToolsPdfExecutionConfig {
  readonly nodeDisplayName: string;
  readonly renderer?: HtmlToPdfRenderer;
}

export interface PlugToolsBarcodeExecutionConfig {
  readonly nodeDisplayName: string;
}

const emptyInputItem: INodeExecutionData = { json: {} };

const toCollection = (
  context: IExecuteFunctions,
  parameterName: string,
  itemIndex: number,
): IDataObject => context.getNodeParameter(parameterName, itemIndex, {}) as IDataObject;

const toOptionalString = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
};

const normalizeOutputBinaryProperty = (value: unknown): string => {
  const propertyName = toOptionalString(value) ?? "data";
  if (!/^[A-Za-z0-9_-]+$/.test(propertyName)) {
    throw new PlugValidationError(
      "Output Binary Property may contain only letters, numbers, underscores, and hyphens",
    );
  }

  return propertyName;
};

const parseAdvancedOptions = (value: unknown): unknown => {
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") {
    return undefined;
  }

  return parseJsonText(text, "Advanced Options JSON");
};

const now = (): number => Date.now();

const serializeErrorForContinueOnFail = (error: unknown): IDataObject => {
  if (error instanceof PlugError) {
    return {
      message: error.message,
      description: error.description,
      code: error.code,
      statusCode: error.statusCode,
      correlationId: error.correlationId,
      retryable: error.retryable,
      retryAfterSeconds: error.retryAfterSeconds,
      technicalMessage: error.technicalMessage,
      details: error.details,
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    };
  }

  return {
    message: "Unknown error",
  };
};

const toNodeOperationError = (
  context: IExecuteFunctions,
  error: unknown,
  nodeDisplayName: string,
  itemIndex: number,
): NodeOperationError => {
  const nodeError =
    error instanceof Error || typeof error === "string"
      ? error
      : isRecord(error)
        ? JSON.stringify(error)
        : new Error(`Unknown ${nodeDisplayName} error`);

  return new NodeOperationError(context.getNode(), nodeError, { itemIndex });
};

export const executePlugToolsPdfNode = async (
  context: IExecuteFunctions,
  config: PlugToolsPdfExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const sourceItems = context.getInputData();
  const items = sourceItems.length > 0 ? sourceItems : [emptyInputItem];
  const renderer = config.renderer ?? createPlaywrightHtmlToPdfRenderer();
  const outputItems: INodeExecutionData[] = [];

  try {
    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      try {
        const browserOptions = toCollection(context, "browserOptions", itemIndex);
        const pdfOptions = toCollection(context, "pdfOptions", itemIndex);
        const outputBinaryProperty = normalizeOutputBinaryProperty(
          context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
        );
        const fileName = normalizePdfFileName(
          context.getNodeParameter("fileName", itemIndex, "document.pdf"),
        );
        const includeMetadata = context.getNodeParameter(
          "includePlugToolsMetadata",
          itemIndex,
          true,
        ) as boolean;

        const browser = resolvePdfBrowserLaunchOptions({
          executablePath: browserOptions.browserExecutablePath,
          channel: browserOptions.browserChannel,
          timeoutMs: browserOptions.timeoutMs,
          enableJavaScript: browserOptions.enableJavaScript,
        });
        const pdf = resolvePdfRenderOptions({
          format: pdfOptions.format,
          landscape: pdfOptions.landscape,
          printBackground: pdfOptions.printBackground,
          preferCSSPageSize: pdfOptions.preferCSSPageSize,
          scale: pdfOptions.scale,
          marginTop: pdfOptions.marginTop,
          marginRight: pdfOptions.marginRight,
          marginBottom: pdfOptions.marginBottom,
          marginLeft: pdfOptions.marginLeft,
          headerTemplate: pdfOptions.headerTemplate,
          footerTemplate: pdfOptions.footerTemplate,
          waitUntil: pdfOptions.waitUntil,
          renderDelayMs: pdfOptions.renderDelayMs,
          maxHtmlSizeBytes: pdfOptions.maxHtmlSizeBytes,
          maxOutputSizeBytes: pdfOptions.maxOutputSizeBytes,
        });
        const html = normalizeHtmlDocument(
          context.getNodeParameter("html", itemIndex),
          context.getNodeParameter("css", itemIndex, ""),
          pdf.maxHtmlSizeBytes,
        );
        const startedAt = now();
        const buffer = await renderer.render({ html, browser, pdf });
        const durationMs = now() - startedAt;
        const binaryData = await context.helpers.prepareBinaryData(
          buffer,
          fileName,
          "application/pdf",
        );

        outputItems.push({
          json: {
            ...items[itemIndex].json,
            ...(includeMetadata
              ? {
                  __plugTools: {
                    operation: "htmlToPdf",
                    fileName,
                    mimeType: "application/pdf",
                    sizeBytes: buffer.length,
                    durationMs,
                    outputBinaryProperty,
                    browser: browser.executablePath ? "executablePath" : browser.channel,
                  },
                }
              : {}),
          },
          binary: {
            ...(items[itemIndex].binary ?? {}),
            [outputBinaryProperty]: binaryData,
          },
          pairedItem: {
            item: itemIndex,
          },
        });
      } catch (error: unknown) {
        if (context.continueOnFail()) {
          outputItems.push({
            json: {
              ...items[itemIndex].json,
              error: serializeErrorForContinueOnFail(error),
            },
            pairedItem: {
              item: itemIndex,
            },
          });
          continue;
        }

        throw toNodeOperationError(context, error, config.nodeDisplayName, itemIndex);
      }
    }
  } finally {
    await renderer.close();
  }

  return [outputItems];
};

export const executePlugToolsBarcodeNode = async (
  context: IExecuteFunctions,
  config: PlugToolsBarcodeExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const sourceItems = context.getInputData();
  const items = sourceItems.length > 0 ? sourceItems : [emptyInputItem];
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
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
        context.getNodeParameter(
          "fileName",
          itemIndex,
          `barcode.${barcode.outputFormat}`,
        ),
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
      const startedAt = now();
      const generated = await generateBarcode(barcode);
      const durationMs = now() - startedAt;
      const binaryData = await context.helpers.prepareBinaryData(
        generated.buffer,
        fileName,
        generated.mimeType,
      );

      outputItems.push({
        json: {
          ...items[itemIndex].json,
          ...(includeMetadata
            ? {
                __plugTools: {
                  operation: "generateCode",
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
                generatedCodeBase64: generated.buffer.toString("base64"),
              }
            : {}),
        },
        binary: {
          ...(items[itemIndex].binary ?? {}),
          [outputBinaryProperty]: binaryData,
        },
        pairedItem: {
          item: itemIndex,
        },
      });
    } catch (error: unknown) {
      if (context.continueOnFail()) {
        outputItems.push({
          json: {
            ...items[itemIndex].json,
            error: serializeErrorForContinueOnFail(error),
          },
          pairedItem: {
            item: itemIndex,
          },
        });
        continue;
      }

      throw toNodeOperationError(context, error, config.nodeDisplayName, itemIndex);
    }
  }

  return [outputItems];
};
