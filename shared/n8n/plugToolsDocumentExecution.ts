import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import {
  createPlaywrightHtmlToPdfRenderer,
  normalizeHtmlDocument,
  normalizePdfFileName,
  resolvePdfBrowserLaunchOptions,
  resolvePdfRenderOptions,
} from "../tools/pdf";
import {
  extractPdfText,
  markdownToHtmlDocument,
  mergePdfBuffers,
  splitPdfBuffer,
  textToHtmlDocument,
} from "../tools/documents";
import {
  plugToolExtractPdfTextOperation,
  plugToolMarkdownToPdfOperation,
  plugToolMergePdfsOperation,
  plugToolSplitPdfOperation,
  plugToolTextToPdfOperation,
} from "./plugToolsDescription";
import {
  assertBufferSize,
  emptyInputItem,
  normalizePositiveIntegerLimit,
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  now,
  serializeErrorForContinueOnFail,
  toCollection,
  toNodeOperationError,
  type PlugToolsPdfExecutionConfig,
} from "./plugToolsCommon";

const renderHtmlPdfOperation = async (
  context: IExecuteFunctions,
  config: PlugToolsPdfExecutionConfig,
  operation: typeof plugToolMarkdownToPdfOperation | typeof plugToolTextToPdfOperation,
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
        const rawHtml =
          operation === plugToolMarkdownToPdfOperation
            ? await markdownToHtmlDocument(
                context.getNodeParameter("markdown", itemIndex),
              )
            : textToHtmlDocument(context.getNodeParameter("text", itemIndex));
        const html = normalizeHtmlDocument(rawHtml, "", pdf.maxHtmlSizeBytes);
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
                    operation,
                    fileName,
                    mimeType: "application/pdf",
                    sizeBytes: buffer.length,
                    durationMs,
                    outputBinaryProperty,
                  },
                }
              : {}),
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
  } finally {
    await renderer.close();
  }

  return [outputItems];
};

export const executePlugToolsDocumentNode = async (
  context: IExecuteFunctions,
  config: PlugToolsPdfExecutionConfig,
  operation:
    | typeof plugToolMarkdownToPdfOperation
    | typeof plugToolTextToPdfOperation
    | typeof plugToolMergePdfsOperation
    | typeof plugToolSplitPdfOperation
    | typeof plugToolExtractPdfTextOperation,
): Promise<INodeExecutionData[][]> => {
  if (
    operation === plugToolMarkdownToPdfOperation ||
    operation === plugToolTextToPdfOperation
  ) {
    return renderHtmlPdfOperation(context, config, operation);
  }

  const items = context.getInputData();
  const outputItems: INodeExecutionData[] = [];

  for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
    try {
      const binaryPropertyName = context.getNodeParameter(
        "binaryPropertyName",
        itemIndex,
        "data",
      ) as string;
      const maxInputSizeBytes = normalizePositiveIntegerLimit(
        context.getNodeParameter("maxInputSizeBytes", itemIndex, 25_000_000),
        25_000_000,
        "Max Input Size Bytes",
      );
      const buffer = await context.helpers.getBinaryDataBuffer(
        itemIndex,
        binaryPropertyName,
      );
      assertBufferSize(buffer, maxInputSizeBytes, "PDF input");

      if (operation === plugToolMergePdfsOperation) {
        const attachments = toCollection(context, "pdfAttachments", itemIndex);
        const attachmentValues = Array.isArray(attachments.values)
          ? attachments.values
          : [];
        const buffers = [buffer];
        for (const attachment of attachmentValues) {
          if (typeof attachment === "object" && attachment !== null) {
            const property = (attachment as Record<string, unknown>).binaryPropertyName;
            if (typeof property === "string" && property.trim()) {
              const attachmentBuffer = await context.helpers.getBinaryDataBuffer(
                itemIndex,
                property,
              );
              assertBufferSize(
                attachmentBuffer,
                maxInputSizeBytes,
                `PDF input ${property}`,
              );
              buffers.push(attachmentBuffer);
            }
          }
        }
        const merged = await mergePdfBuffers(buffers);
        const outputBinaryProperty = normalizeOutputBinaryProperty(
          context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
        );
        const binaryData = await context.helpers.prepareBinaryData(
          merged,
          "merged.pdf",
          "application/pdf",
        );
        outputItems.push({
          json: {
            ...items[itemIndex].json,
            __plugTools: {
              operation,
              inputCount: buffers.length,
              sizeBytes: merged.length,
              outputBinaryProperty,
            },
          },
          binary: {
            ...(items[itemIndex].binary ?? {}),
            [outputBinaryProperty]: binaryData,
          },
          pairedItem: { item: itemIndex },
        });
        continue;
      }

      if (operation === plugToolSplitPdfOperation) {
        const outputBinaryProperty = normalizeOutputBinaryProperty(
          context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
        );
        const pages = await splitPdfBuffer(
          buffer,
          context.getNodeParameter("pageRange", itemIndex, "") as string,
        );
        for (const page of pages) {
          const binaryData = await context.helpers.prepareBinaryData(
            page.buffer,
            `page-${page.pageNumber}.pdf`,
            "application/pdf",
          );
          outputItems.push({
            json: {
              ...items[itemIndex].json,
              __plugTools: {
                operation,
                pageNumber: page.pageNumber,
                sizeBytes: page.buffer.length,
                outputBinaryProperty,
              },
            },
            binary: {
              ...(items[itemIndex].binary ?? {}),
              [outputBinaryProperty]: binaryData,
            },
            pairedItem: { item: itemIndex },
          });
        }
        continue;
      }

      const outputJsonProperty = normalizeOutputJsonProperty(
        context.getNodeParameter("outputJsonProperty", itemIndex, "pdfText"),
        "pdfText",
        "Output JSON Property",
      );
      const extracted = await extractPdfText(buffer);
      outputItems.push({
        json: {
          ...items[itemIndex].json,
          [outputJsonProperty]: extracted,
          __plugTools: {
            operation,
            pages: extracted.pages.length,
            textLength: extracted.text.length,
          },
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
