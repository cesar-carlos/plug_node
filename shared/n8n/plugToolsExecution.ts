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
  plugToolWaitForSocketEventOperation,
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
  PlugToolsSocketEventListenInput,
  PlugToolsSocketEventListenResult,
  PlugToolsSocketEventListener,
  PlugToolsSocketEventPublishInput,
  PlugToolsSocketEventPublisher,
} from "./plugToolsCommon";

type PlugToolsOperationExecutor = (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
  operation: string,
) => Promise<INodeExecutionData[][]>;

const legacyPublishSocketEventOperation = "publishEvent";

const documentOperations = new Set<string>([
  plugToolMarkdownToPdfOperation,
  plugToolTextToPdfOperation,
  plugToolMergePdfsOperation,
  plugToolSplitPdfOperation,
  plugToolExtractPdfTextOperation,
]);

const imageOperations = new Set<string>([
  plugToolResizeImageOperation,
  plugToolConvertImageOperation,
  plugToolCompressImageOperation,
  plugToolAddImageWatermarkOperation,
  plugToolCreateThumbnailOperation,
]);

const utilityOperations = new Set<string>([
  plugToolReadBarcodeOperation,
  plugToolValidateCpfCnpjOperation,
  plugToolFormatCpfCnpjOperation,
  plugToolGenerateUuidOperation,
  plugToolTransformJsonOperation,
  plugToolCsvToJsonOperation,
  plugToolJsonToCsvOperation,
  plugToolNormalizeTextOperation,
  plugToolExtractRegexFieldsOperation,
  plugToolValidateJsonSchemaOperation,
  plugToolGenerateHashOperation,
  plugToolHmacSignOperation,
  plugToolBase64Operation,
  plugToolJwtDecodeOperation,
  plugToolEncryptTextOperation,
  plugToolDecryptTextOperation,
  plugToolFormatDateOperation,
  plugToolParseDateOperation,
  plugToolAddBusinessDaysOperation,
  plugToolFormatCurrencyOperation,
  plugToolNumberToWordsOperation,
  plugToolBuildSocketEventPayloadOperation,
  plugToolValidateClientTokenOperation,
  plugToolValidateAgentContextOperation,
  plugToolBuildSqlRequestOperation,
  plugToolParseSqlRowsOperation,
  plugToolGenerateAccessRequestSummaryOperation,
]);

const socketEventOperations = new Set<string>([
  plugToolPublishSocketEventOperation,
  legacyPublishSocketEventOperation,
  plugToolWaitForSocketEventOperation,
]);

const executeDocumentOperation: PlugToolsOperationExecutor = (
  context,
  config,
  operation,
) =>
  executePlugToolsDocumentNode(
    context,
    config,
    operation as Parameters<typeof executePlugToolsDocumentNode>[2],
  );

const executeImageOperation: PlugToolsOperationExecutor = (context, config, operation) =>
  executePlugToolsImageNode(
    context,
    config,
    operation as Parameters<typeof executePlugToolsImageNode>[2],
  );

const executeUtilityOperation: PlugToolsOperationExecutor = (
  context,
  config,
  operation,
) =>
  executePlugToolsUtilityNode(
    context,
    config,
    operation as Parameters<typeof executePlugToolsUtilityNode>[2],
  );

const executeSocketEventOperation: PlugToolsOperationExecutor = (context, config) =>
  executePlugToolsSocketEventNode(context, config);

const plugToolsOperationRegistry = new Map<string, PlugToolsOperationExecutor>([
  [
    plugToolHtmlToPdfOperation,
    (context, config) => executePlugToolsPdfNode(context, config),
  ],
  [
    plugToolGenerateBarcodeOperation,
    (context, config) => executePlugToolsBarcodeNode(context, config),
  ],
]);

for (const operation of documentOperations) {
  plugToolsOperationRegistry.set(operation, executeDocumentOperation);
}

for (const operation of imageOperations) {
  plugToolsOperationRegistry.set(operation, executeImageOperation);
}

for (const operation of utilityOperations) {
  plugToolsOperationRegistry.set(operation, executeUtilityOperation);
}

for (const operation of socketEventOperations) {
  plugToolsOperationRegistry.set(operation, executeSocketEventOperation);
}

export const executePlugToolsResource = async (
  context: IExecuteFunctions,
  config: PlugToolsExecutionConfig,
): Promise<INodeExecutionData[][]> => {
  const operation = context.getNodeParameter(
    "operation",
    0,
    plugToolHtmlToPdfOperation,
  ) as string;

  const executor = plugToolsOperationRegistry.get(operation);
  if (!executor) {
    throw new PlugValidationError(`Unsupported Plug tool operation: ${operation}`);
  }

  return executor(context, config, operation);
};
