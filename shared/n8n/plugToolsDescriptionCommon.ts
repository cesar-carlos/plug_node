import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import {
  applyToolExposure,
  plugToolExposureConsolidated,
  type PlugToolExposure,
} from "./toolExposure";
export interface PlugToolNodeDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly iconBaseName: string;
  readonly description: string;
  readonly toolExposure?: PlugToolExposure;
}

export interface PlugToolsPropertiesOptions {
  readonly supportsSocketPublish: boolean;
  readonly supportsSocketListen?: boolean;
  readonly operation?: string;
}

export const plugToolHtmlToPdfOperation = "htmlToPdf" as const;
export const plugToolMarkdownToPdfOperation = "markdownToPdf" as const;
export const plugToolTextToPdfOperation = "textToPdf" as const;
export const plugToolMergePdfsOperation = "mergePdfs" as const;
export const plugToolSplitPdfOperation = "splitPdf" as const;
export const plugToolExtractPdfTextOperation = "extractPdfText" as const;
export const plugToolResizeImageOperation = "resizeImage" as const;
export const plugToolConvertImageOperation = "convertImage" as const;
export const plugToolCompressImageOperation = "compressImage" as const;
export const plugToolAddImageWatermarkOperation = "addImageWatermark" as const;
export const plugToolCreateThumbnailOperation = "createThumbnail" as const;
export const plugToolGenerateBarcodeOperation = "generateCode" as const;
export const plugToolReadBarcodeOperation = "readBarcode" as const;
export const plugToolValidateCpfCnpjOperation = "validateCpfCnpj" as const;
export const plugToolFormatCpfCnpjOperation = "formatCpfCnpj" as const;
export const plugToolGenerateUuidOperation = "generateUuid" as const;
export const plugToolTransformJsonOperation = "transformJson" as const;
export const plugToolCsvToJsonOperation = "csvToJson" as const;
export const plugToolJsonToCsvOperation = "jsonToCsv" as const;
export const plugToolNormalizeTextOperation = "normalizeText" as const;
export const plugToolExtractRegexFieldsOperation = "extractRegexFields" as const;
export const plugToolValidateJsonSchemaOperation = "validateJsonSchema" as const;
export const plugToolGenerateHashOperation = "generateHash" as const;
export const plugToolHmacSignOperation = "hmacSign" as const;
export const plugToolBase64Operation = "base64" as const;
export const plugToolJwtDecodeOperation = "jwtDecode" as const;
export const plugToolEncryptTextOperation = "encryptText" as const;
export const plugToolDecryptTextOperation = "decryptText" as const;
export const plugToolFormatDateOperation = "formatDate" as const;
export const plugToolParseDateOperation = "parseDate" as const;
export const plugToolAddBusinessDaysOperation = "addBusinessDays" as const;
export const plugToolFormatCurrencyOperation = "formatCurrency" as const;
export const plugToolNumberToWordsOperation = "numberToWords" as const;
export const plugToolBuildSocketEventPayloadOperation =
  "buildSocketEventPayload" as const;
export const plugToolValidateClientTokenOperation = "validateClientToken" as const;
export const plugToolValidateAgentContextOperation = "validateAgentContext" as const;
export const plugToolBuildSqlRequestOperation = "buildSqlRequest" as const;
export const plugToolParseSqlRowsOperation = "parseSqlRows" as const;
export const plugToolGenerateAccessRequestSummaryOperation =
  "generateAccessRequestSummary" as const;
export const plugToolPublishSocketEventOperation = "publishSocketEvent" as const;
export const plugToolWaitForSocketEventOperation = "waitForSocketEvent" as const;

export const plugToolCategoryDocuments = "documents" as const;
export const plugToolCategoryImage = "image" as const;
export const plugToolCategoryIdentity = "identity" as const;
export const plugToolCategoryData = "data" as const;
export const plugToolCategorySecurity = "security" as const;
export const plugToolCategoryDateValue = "dateValue" as const;
export const plugToolCategoryPlugSpecific = "plugSpecific" as const;
export const plugToolCategorySocket = "socket" as const;

export type PlugToolCategory =
  | typeof plugToolCategoryDocuments
  | typeof plugToolCategoryImage
  | typeof plugToolCategoryIdentity
  | typeof plugToolCategoryData
  | typeof plugToolCategorySecurity
  | typeof plugToolCategoryDateValue
  | typeof plugToolCategoryPlugSpecific
  | typeof plugToolCategorySocket;

export const plugToolOperationsByCategory = {
  [plugToolCategoryDocuments]: [
    plugToolHtmlToPdfOperation,
    plugToolMarkdownToPdfOperation,
    plugToolTextToPdfOperation,
    plugToolMergePdfsOperation,
    plugToolSplitPdfOperation,
    plugToolExtractPdfTextOperation,
  ],
  [plugToolCategoryImage]: [
    plugToolResizeImageOperation,
    plugToolConvertImageOperation,
    plugToolCompressImageOperation,
    plugToolAddImageWatermarkOperation,
    plugToolCreateThumbnailOperation,
  ],
  [plugToolCategoryIdentity]: [
    plugToolGenerateBarcodeOperation,
    plugToolReadBarcodeOperation,
    plugToolValidateCpfCnpjOperation,
    plugToolFormatCpfCnpjOperation,
    plugToolGenerateUuidOperation,
  ],
  [plugToolCategoryData]: [
    plugToolTransformJsonOperation,
    plugToolCsvToJsonOperation,
    plugToolJsonToCsvOperation,
    plugToolNormalizeTextOperation,
    plugToolExtractRegexFieldsOperation,
    plugToolValidateJsonSchemaOperation,
  ],
  [plugToolCategorySecurity]: [
    plugToolGenerateHashOperation,
    plugToolHmacSignOperation,
    plugToolBase64Operation,
    plugToolJwtDecodeOperation,
    plugToolEncryptTextOperation,
    plugToolDecryptTextOperation,
  ],
  [plugToolCategoryDateValue]: [
    plugToolFormatDateOperation,
    plugToolParseDateOperation,
    plugToolAddBusinessDaysOperation,
    plugToolFormatCurrencyOperation,
    plugToolNumberToWordsOperation,
  ],
  [plugToolCategoryPlugSpecific]: [
    plugToolBuildSocketEventPayloadOperation,
    plugToolValidateClientTokenOperation,
    plugToolValidateAgentContextOperation,
    plugToolBuildSqlRequestOperation,
    plugToolParseSqlRowsOperation,
    plugToolGenerateAccessRequestSummaryOperation,
  ],
  [plugToolCategorySocket]: [
    plugToolPublishSocketEventOperation,
    plugToolWaitForSocketEventOperation,
  ],
} satisfies Record<PlugToolCategory, readonly string[]>;

export const plugToolCategoryOptions: readonly {
  readonly name: string;
  readonly value: PlugToolCategory;
  readonly description: string;
}[] = [
  {
    name: "Documents",
    value: plugToolCategoryDocuments,
    description: "PDF and document conversion tools.",
  },
  {
    name: "Image",
    value: plugToolCategoryImage,
    description: "Image resize, conversion, compression, and watermark tools.",
  },
  {
    name: "Code / Identification",
    value: plugToolCategoryIdentity,
    description: "Barcode, QR, CPF/CNPJ, and UUID tools.",
  },
  {
    name: "Data",
    value: plugToolCategoryData,
    description: "JSON, CSV, regex, text normalization, and JSON Schema tools.",
  },
  {
    name: "Security",
    value: plugToolCategorySecurity,
    description: "Hash, HMAC, Base64, JWT decode, and encryption helpers.",
  },
  {
    name: "Dates / Values",
    value: plugToolCategoryDateValue,
    description: "Date, currency, business-day, and number formatting tools.",
  },
  {
    name: "Plug Specific",
    value: plugToolCategoryPlugSpecific,
    description: "Helpers for Plug SQL, token, context, and access payloads.",
  },
  {
    name: "Socket",
    value: plugToolCategorySocket,
    description:
      "Publish Plug custom socket events or wait for them from the consolidated advanced tool menu.",
  },
];

export const addOperationDisplayOption = (
  property: INodeProperties,
  operation: string,
): INodeProperties => ({
  ...property,
  displayOptions: {
    ...property.displayOptions,
    show: {
      ...(property.displayOptions?.show ?? {}),
      operation: [operation],
    },
  },
});

export const addToolCategoryDisplayOption = (
  property: INodeProperties,
  toolCategory: PlugToolCategory,
): INodeProperties => ({
  ...property,
  displayOptions: {
    ...property.displayOptions,
    show: {
      ...(property.displayOptions?.show ?? {}),
      toolCategory: [toolCategory],
    },
  },
});

export const buildCommonDescription = (
  options: PlugToolNodeDescriptionOptions,
  properties: INodeProperties[],
): INodeTypeDescription =>
  applyToolExposure(
    {
      displayName: options.displayName,
      name: options.technicalName,
      icon: `file:${options.iconBaseName}.svg`,
      group: ["transform"],
      version: 1,
      subtitle: '={{$parameter["operation"]}}',
      description: options.description,
      defaults: {
        name: options.displayName,
      },
      inputs: [NodeConnectionTypes.Main],
      outputs: [NodeConnectionTypes.Main],
      properties,
    },
    options.toolExposure ?? plugToolExposureConsolidated,
  );

export const binaryInputProperty = (operation: string): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName: "Binary Property",
      name: "binaryPropertyName",
      type: "string",
      default: "data",
      description: "Binary property to read from each input item.",
    },
    operation,
  );

export const maxInputSizeProperty = (
  operation: string,
  defaultValue = 25_000_000,
): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName: "Max Input Size Bytes",
      name: "maxInputSizeBytes",
      type: "number",
      default: defaultValue,
      typeOptions: { minValue: 1 },
      description: "Maximum input binary size in bytes for each item.",
    },
    operation,
  );

export const outputBinaryProperty = (operation: string): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName: "Output Binary Property",
      name: "outputBinaryProperty",
      type: "string",
      default: "data",
      description: "Binary property where the generated file should be stored.",
    },
    operation,
  );

export const outputJsonProperty = (
  operation: string,
  defaultValue = "result",
): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName: "Output JSON Property",
      name: "outputJsonProperty",
      type: "string",
      default: defaultValue,
      description: "JSON property where the tool result should be stored.",
    },
    operation,
  );

export const toolTextField = (
  operation: string,
  name: string,
  displayName: string,
  defaultValue = "",
  rows = 3,
  type: INodeProperties["type"] = "string",
): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName,
      name,
      type,
      default: defaultValue,
      required: true,
      typeOptions: {
        rows,
      },
    },
    operation,
  );

export const passwordField = (
  operation: string,
  name: string,
  displayName: string,
): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName,
      name,
      type: "string",
      default: "",
      required: true,
      typeOptions: {
        password: true,
      },
    },
    operation,
  );

export const imageOutputFormatOption: INodeProperties = {
  displayName: "Output Format",
  name: "format",
  type: "options",
  default: "png",
  options: [
    { name: "PNG", value: "png" },
    { name: "JPEG", value: "jpeg" },
    { name: "WebP", value: "webp" },
  ],
};

export const imageQualityOption: INodeProperties = {
  displayName: "Quality",
  name: "quality",
  type: "number",
  default: 80,
  typeOptions: { minValue: 1, maxValue: 100 },
};

export const imageMaxOutputSizeOption: INodeProperties = {
  displayName: "Max Output Size Bytes",
  name: "maxOutputSizeBytes",
  type: "number",
  default: 25_000_000,
  typeOptions: { minValue: 1 },
};

export const imageOptionsProperty = (
  operation: string,
  options: readonly INodeProperties[],
): INodeProperties =>
  addOperationDisplayOption(
    {
      displayName: "Image Options",
      name: "imageOptions",
      type: "collection",
      placeholder: "Add image option",
      default: {},
      options: [...options, imageMaxOutputSizeOption],
    },
    operation,
  );
