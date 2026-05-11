import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import {
  createPlaywrightHtmlToPdfRenderer,
  normalizeHtmlDocument,
  normalizePdfFileName,
  resolvePdfBrowserLaunchOptions,
  resolvePdfRenderOptions,
} from "../tools/pdf";
import { plugToolHtmlToPdfOperation } from "./plugToolsDescription";
import {
  emptyInputItem,
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  now,
  serializeErrorForContinueOnFail,
  toCollection,
  toNodeOperationError,
  type PlugToolsPdfExecutionConfig,
} from "./plugToolsCommon";

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
        const metadataProperty = includeMetadata
          ? normalizeOutputJsonProperty(
              context.getNodeParameter("metadataProperty", itemIndex, "__plugTools"),
              "__plugTools",
              "Metadata Property",
            )
          : undefined;

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
          media: pdfOptions.media,
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
                  [metadataProperty ?? "__plugTools"]: {
                    operation: plugToolHtmlToPdfOperation,
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
