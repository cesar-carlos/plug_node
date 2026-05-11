import type { IExecuteFunctions, INodeExecutionData } from "n8n-workflow";

import { PlugValidationError } from "../contracts/errors";
import {
  plugToolAddBusinessDaysOperation,
  plugToolAddImageWatermarkOperation,
  plugToolBase64Operation,
  plugToolBuildSocketEventPayloadOperation,
  plugToolBuildSqlRequestOperation,
  plugToolCompressImageOperation,
  plugToolConvertImageOperation,
  plugToolCreateThumbnailOperation,
  plugToolCsvToJsonOperation,
  plugToolDecryptTextOperation,
  plugToolEncryptTextOperation,
  plugToolExtractPdfTextOperation,
  plugToolExtractRegexFieldsOperation,
  plugToolFormatCpfCnpjOperation,
  plugToolFormatCurrencyOperation,
  plugToolFormatDateOperation,
  plugToolGenerateAccessRequestSummaryOperation,
  plugToolGenerateBarcodeOperation,
  plugToolGenerateHashOperation,
  plugToolGenerateUuidOperation,
  plugToolHtmlToPdfOperation,
  plugToolHmacSignOperation,
  plugToolJsonToCsvOperation,
  plugToolJwtDecodeOperation,
  plugToolMarkdownToPdfOperation,
  plugToolMergePdfsOperation,
  plugToolNormalizeTextOperation,
  plugToolNumberToWordsOperation,
  plugToolParseDateOperation,
  plugToolParseSqlRowsOperation,
  plugToolPublishSocketEventOperation,
  plugToolReadBarcodeOperation,
  plugToolResizeImageOperation,
  plugToolSplitPdfOperation,
  plugToolTextToPdfOperation,
  plugToolTransformJsonOperation,
  plugToolValidateAgentContextOperation,
  plugToolValidateClientTokenOperation,
  plugToolValidateCpfCnpjOperation,
  plugToolValidateJsonSchemaOperation,
} from "./plugToolsDescription";
import { executePlugToolsBarcodeNode } from "./plugToolsBarcodeExecution";
import { executePlugToolsDocumentNode } from "./plugToolsDocumentExecution";
import { executePlugToolsImageNode } from "./plugToolsImageExecution";
import { executePlugToolsPdfNode } from "./plugToolsPdfExecution";
import { executePlugToolsSocketEventNode } from "./plugToolsSocketEventExecution";
import { executePlugToolsUtilityNode } from "./plugToolsUtilityExecution";
import type { PlugToolsExecutionConfig } from "./plugToolsCommon";

export { executePlugToolsBarcodeNode } from "./plugToolsBarcodeExecution";
export { executePlugToolsDocumentNode } from "./plugToolsDocumentExecution";
export { executePlugToolsImageNode } from "./plugToolsImageExecution";
export { executePlugToolsPdfNode } from "./plugToolsPdfExecution";
export { executePlugToolsSocketEventNode } from "./plugToolsSocketEventExecution";
export { executePlugToolsUtilityNode } from "./plugToolsUtilityExecution";
export type {
  PlugToolsBarcodeExecutionConfig,
  PlugToolsExecutionConfig,
  PlugToolsPdfExecutionConfig,
  PlugToolsSocketEventPublishInput,
  PlugToolsSocketEventPublisher,
} from "./plugToolsCommon";

export const executePlugToolsResource = async (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const operation = context.getNodeParameter(
    "operation",
    0,
    plugToolHtmlToPdfOperation,
  ) as string;

  switch (operation) {
    case plugToolHtmlToPdfOperation:
      return executePlugToolsPdfNode(context, config);
    case plugToolMarkdownToPdfOperation:
    case plugToolTextToPdfOperation:
    case plugToolMergePdfsOperation:
    case plugToolSplitPdfOperation:
    case plugToolExtractPdfTextOperation:
      return executePlugToolsDocumentNode(context, config, operation);
    case plugToolResizeImageOperation:
    case plugToolConvertImageOperation:
    case plugToolCompressImageOperation:
    case plugToolAddImageWatermarkOperation:
    case plugToolCreateThumbnailOperation:
      return executePlugToolsImageNode(context, config, operation);
    case plugToolGenerateBarcodeOperation:
      return executePlugToolsBarcodeNode(context, config);
    case plugToolReadBarcodeOperation:
    case plugToolValidateCpfCnpjOperation:
    case plugToolFormatCpfCnpjOperation:
    case plugToolGenerateUuidOperation:
    case plugToolTransformJsonOperation:
    case plugToolCsvToJsonOperation:
    case plugToolJsonToCsvOperation:
    case plugToolNormalizeTextOperation:
    case plugToolExtractRegexFieldsOperation:
    case plugToolValidateJsonSchemaOperation:
    case plugToolGenerateHashOperation:
    case plugToolHmacSignOperation:
    case plugToolBase64Operation:
    case plugToolJwtDecodeOperation:
    case plugToolEncryptTextOperation:
    case plugToolDecryptTextOperation:
    case plugToolFormatDateOperation:
    case plugToolParseDateOperation:
    case plugToolAddBusinessDaysOperation:
    case plugToolFormatCurrencyOperation:
    case plugToolNumberToWordsOperation:
    case plugToolBuildSocketEventPayloadOperation:
    case plugToolValidateClientTokenOperation:
    case plugToolValidateAgentContextOperation:
    case plugToolBuildSqlRequestOperation:
    case plugToolParseSqlRowsOperation:
    case plugToolGenerateAccessRequestSummaryOperation:
      return executePlugToolsUtilityNode(context, config, operation);
    case plugToolPublishSocketEventOperation:
      return executePlugToolsSocketEventNode(context, config);
    default:
      throw new PlugValidationError(`Unsupported Plug tool operation: ${operation}`);
  }
};
