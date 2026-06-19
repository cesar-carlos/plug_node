import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import {
  extractPdfText,
  markdownToHtmlDocument,
  mergePdfBuffers,
  splitPdfBuffer,
  textToHtmlDocument,
} from "../tools/documents";
import { normalizeHtmlDocument } from "../tools/pdf";
import {
  plugToolExtractPdfTextOperation,
  plugToolMarkdownToPdfOperation,
  plugToolMergePdfsOperation,
  plugToolSplitPdfOperation,
  plugToolTextToPdfOperation,
} from "./plugToolsDescription";
import {
  assertBufferSize,
  normalizePositiveIntegerLimit,
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  toCollection,
  toNodeOperationError,
  type PlugToolsPdfExecutionConfig,
} from "./plugToolsCommon";
import { executeHtmlToPdfItems } from "./plugToolsHtmlToPdf";
import { executePerInputItem } from "./plugItemExecution";

const renderHtmlPdfOperation = async (
  context: IExecuteFunctions,
  config: PlugToolsPdfExecutionConfig,
  operation: typeof plugToolMarkdownToPdfOperation | typeof plugToolTextToPdfOperation,
): Promise<INodeExecutionData[][]> =>
  executeHtmlToPdfItems({
    context,
    config,
    operation,
    resolveHtml: async (itemIndex, pdf) => {
      const rawHtml =
        operation === plugToolMarkdownToPdfOperation
          ? await markdownToHtmlDocument(context.getNodeParameter("markdown", itemIndex))
          : textToHtmlDocument(context.getNodeParameter("text", itemIndex));
      return normalizeHtmlDocument(rawHtml, "", pdf.maxHtmlSizeBytes);
    },
  });

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

  return executePerInputItem(
    context,
    async (itemIndex, item) => {
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

        return {
          json: {
            ...item.json,
            __plugTools: {
              operation,
              inputCount: buffers.length,
              sizeBytes: merged.length,
              outputBinaryProperty,
            },
          },
          binary: {
            ...(item.binary ?? {}),
            [outputBinaryProperty]: binaryData,
          },
          pairedItem: { item: itemIndex },
        };
      }

      if (operation === plugToolSplitPdfOperation) {
        const outputBinaryProperty = normalizeOutputBinaryProperty(
          context.getNodeParameter("outputBinaryProperty", itemIndex, "data"),
        );
        const pages = await splitPdfBuffer(
          buffer,
          context.getNodeParameter("pageRange", itemIndex, "") as string,
        );
        const pageItems: INodeExecutionData[] = [];

        for (const page of pages) {
          const binaryData = await context.helpers.prepareBinaryData(
            page.buffer,
            `page-${page.pageNumber}.pdf`,
            "application/pdf",
          );
          pageItems.push({
            json: {
              ...item.json,
              __plugTools: {
                operation,
                pageNumber: page.pageNumber,
                sizeBytes: page.buffer.length,
                outputBinaryProperty,
              },
            },
            binary: {
              ...(item.binary ?? {}),
              [outputBinaryProperty]: binaryData,
            },
            pairedItem: { item: itemIndex },
          });
        }

        return pageItems;
      }

      const outputJsonProperty = normalizeOutputJsonProperty(
        context.getNodeParameter("outputJsonProperty", itemIndex, "pdfText"),
        "pdfText",
        "Output JSON Property",
      );
      const extracted = await extractPdfText(buffer);

      return {
        json: {
          ...item.json,
          [outputJsonProperty]: extracted,
          __plugTools: {
            operation,
            pages: extracted.pages.length,
            textLength: extracted.text.length,
          },
        },
        pairedItem: { item: itemIndex },
      };
    },
    {
      onError: (error, itemIndex) =>
        toNodeOperationError(context, error, config.nodeDisplayName, itemIndex),
    },
  );
};
