import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import {
  createPlaywrightHtmlToPdfRenderer,
  normalizePdfFileName,
  resolvePdfBrowserLaunchOptions,
  resolvePdfRenderOptions,
  type PdfRenderOptions,
} from "../tools/pdf";
import {
  normalizeOutputBinaryProperty,
  normalizeOutputJsonProperty,
  now,
  toCollection,
  toNodeOperationError,
  type PlugToolsPdfExecutionConfig,
} from "./plugToolsCommon";
import { executePerInputItem } from "./plugItemExecution";

export interface ExecuteHtmlToPdfItemsInput {
  readonly context: IExecuteFunctions;
  readonly config: PlugToolsPdfExecutionConfig;
  readonly operation: string;
  readonly resolveHtml: (
    itemIndex: number,
    pdf: PdfRenderOptions,
  ) => Promise<string> | string;
}

const readHtmlToPdfItemOptions = (
  context: IExecuteFunctions,
  itemIndex: number,
): {
  browserOptions: ReturnType<typeof toCollection>;
  pdfOptions: ReturnType<typeof toCollection>;
  outputBinaryProperty: string;
  fileName: string;
  includeMetadata: boolean;
  metadataProperty: string | undefined;
  browser: ReturnType<typeof resolvePdfBrowserLaunchOptions>;
  pdf: ReturnType<typeof resolvePdfRenderOptions>;
} => {
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

  return {
    browserOptions,
    pdfOptions,
    outputBinaryProperty,
    fileName,
    includeMetadata,
    metadataProperty,
    browser,
    pdf,
  };
};

export const executeHtmlToPdfItems = async (
  input: ExecuteHtmlToPdfItemsInput,
): Promise<INodeExecutionData[][]> => {
  const { context, config, operation, resolveHtml } = input;
  const renderer = config.renderer ?? createPlaywrightHtmlToPdfRenderer();

  try {
    return await executePerInputItem(
      context,
      async (itemIndex, item) => {
        const options = readHtmlToPdfItemOptions(context, itemIndex);
        const html = await resolveHtml(itemIndex, options.pdf);
        const startedAt = now();
        const buffer = await renderer.render({
          html,
          browser: options.browser,
          pdf: options.pdf,
        });
        const durationMs = now() - startedAt;
        const binaryData = await context.helpers.prepareBinaryData(
          buffer,
          options.fileName,
          "application/pdf",
        );

        return {
          json: {
            ...item.json,
            ...(options.includeMetadata
              ? {
                  [options.metadataProperty ?? "__plugTools"]: {
                    operation,
                    fileName: options.fileName,
                    mimeType: "application/pdf",
                    sizeBytes: buffer.length,
                    durationMs,
                    outputBinaryProperty: options.outputBinaryProperty,
                    browser: options.browser.executablePath
                      ? "executablePath"
                      : (options.browser.channel ?? "chromium"),
                    browserSource: options.browser.source,
                  },
                }
              : {}),
          },
          binary: {
            ...(item.binary ?? {}),
            [options.outputBinaryProperty]: binaryData,
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
  } finally {
    await renderer.close();
  }
};
