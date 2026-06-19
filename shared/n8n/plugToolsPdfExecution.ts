import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { normalizeHtmlDocument } from "../tools/pdf";
import { plugToolHtmlToPdfOperation } from "./plugToolsDescription";
import { type PlugToolsPdfExecutionConfig } from "./plugToolsCommon";
import { executeHtmlToPdfItems } from "./plugToolsHtmlToPdf";

export const executePlugToolsPdfNode = async (
  context: IExecuteFunctions,
  config: PlugToolsPdfExecutionConfig,
): Promise<INodeExecutionData[][]> =>
  executeHtmlToPdfItems({
    context,
    config,
    operation: plugToolHtmlToPdfOperation,
    resolveHtml: (itemIndex, pdf) =>
      normalizeHtmlDocument(
        context.getNodeParameter("html", itemIndex),
        context.getNodeParameter("css", itemIndex, ""),
        pdf.maxHtmlSizeBytes,
      ),
  });
