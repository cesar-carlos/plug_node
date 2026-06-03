import type { INodeProperties } from "n8n-workflow";
import {
  addToolCategoryDisplayOption,
  plugToolOperationsByCategory,
  plugToolCategoryOptions,
  plugToolCategoryDocuments,
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
  plugToolHmacSignOperation,
  plugToolHtmlToPdfOperation,
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
  type PlugToolsPropertiesOptions,
} from "./plugToolsDescriptionCommon";

export const buildPlugToolsOperationProperty = (): INodeProperties => ({
  displayName: "Operation",
  name: "operation",
  type: "options",
  default: plugToolHtmlToPdfOperation,
  noDataExpression: true,
  options: [
    {
      name: "HTML to PDF",
      value: plugToolHtmlToPdfOperation,
      description: "Render an HTML string to a PDF binary file.",
      action: "Render HTML to PDF",
    },
    {
      name: "Markdown to PDF",
      value: plugToolMarkdownToPdfOperation,
      description: "Render Markdown to a PDF binary file.",
      action: "Render Markdown to PDF",
    },
    {
      name: "Text to PDF",
      value: plugToolTextToPdfOperation,
      description: "Render plain text to a PDF binary file.",
      action: "Render text to PDF",
    },
    {
      name: "Merge PDFs",
      value: plugToolMergePdfsOperation,
      description: "Merge PDF binaries into one PDF.",
      action: "Merge PDFs",
    },
    {
      name: "Split PDF",
      value: plugToolSplitPdfOperation,
      description: "Split a PDF into page PDFs.",
      action: "Split PDF",
    },
    {
      name: "Extract PDF Text",
      value: plugToolExtractPdfTextOperation,
      description: "Extract text from a PDF binary file.",
      action: "Extract PDF text",
    },
    {
      name: "Resize Image",
      value: plugToolResizeImageOperation,
      description: "Resize an image binary file.",
      action: "Resize image",
    },
    {
      name: "Convert Image",
      value: plugToolConvertImageOperation,
      description: "Convert an image binary file to another format.",
      action: "Convert image",
    },
    {
      name: "Compress Image",
      value: plugToolCompressImageOperation,
      description: "Compress an image binary file.",
      action: "Compress image",
    },
    {
      name: "Add Image Watermark",
      value: plugToolAddImageWatermarkOperation,
      description: "Add a text watermark to an image binary file.",
      action: "Add image watermark",
    },
    {
      name: "Create Thumbnail",
      value: plugToolCreateThumbnailOperation,
      description: "Create a thumbnail from an image binary file.",
      action: "Create thumbnail",
    },
    {
      name: "Generate Barcode",
      value: plugToolGenerateBarcodeOperation,
      description: "Generate a QR code or barcode binary file.",
      action: "Generate a QR code or barcode",
    },
    {
      name: "Read Barcode",
      value: plugToolReadBarcodeOperation,
      description: "Read a barcode or QR code from an image binary file.",
      action: "Read barcode",
    },
    {
      name: "Validate CPF/CNPJ",
      value: plugToolValidateCpfCnpjOperation,
      description: "Validate a Brazilian CPF or CNPJ value.",
      action: "Validate CPF or CNPJ",
    },
    {
      name: "Format CPF/CNPJ",
      value: plugToolFormatCpfCnpjOperation,
      description: "Format a valid Brazilian CPF or CNPJ value.",
      action: "Format CPF or CNPJ",
    },
    {
      name: "Generate UUID",
      value: plugToolGenerateUuidOperation,
      description: "Generate a UUID v4 value.",
      action: "Generate UUID",
    },
    {
      name: "Transform JSON",
      value: plugToolTransformJsonOperation,
      description: "Transform item JSON using JSONata.",
      action: "Transform JSON",
    },
    {
      name: "CSV to JSON",
      value: plugToolCsvToJsonOperation,
      description: "Parse CSV text into JSON rows.",
      action: "Convert CSV to JSON",
    },
    {
      name: "JSON to CSV",
      value: plugToolJsonToCsvOperation,
      description: "Convert JSON rows to CSV text.",
      action: "Convert JSON to CSV",
    },
    {
      name: "Normalize Text",
      value: plugToolNormalizeTextOperation,
      description: "Trim, normalize, and change text case.",
      action: "Normalize text",
    },
    {
      name: "Extract Regex Fields",
      value: plugToolExtractRegexFieldsOperation,
      description: "Extract fields from text using a regular expression.",
      action: "Extract regex fields",
    },
    {
      name: "Validate JSON Schema",
      value: plugToolValidateJsonSchemaOperation,
      description: "Validate JSON data using JSON Schema.",
      action: "Validate JSON schema",
    },
    {
      name: "Generate Hash",
      value: plugToolGenerateHashOperation,
      description: "Generate a cryptographic hash.",
      action: "Generate hash",
    },
    {
      name: "HMAC Sign",
      value: plugToolHmacSignOperation,
      description: "Sign text using HMAC.",
      action: "Sign HMAC",
    },
    {
      name: "Base64 Encode/Decode",
      value: plugToolBase64Operation,
      description: "Encode or decode Base64 text.",
      action: "Encode or decode Base64",
    },
    {
      name: "JWT Decode",
      value: plugToolJwtDecodeOperation,
      description: "Decode JWT header and payload without verifying signature.",
      action: "Decode JWT",
    },
    {
      name: "Encrypt Text",
      value: plugToolEncryptTextOperation,
      description: "Encrypt text using AES-256-GCM.",
      action: "Encrypt text",
    },
    {
      name: "Decrypt Text",
      value: plugToolDecryptTextOperation,
      description: "Decrypt text encrypted by the AES-256-GCM helper.",
      action: "Decrypt text",
    },
    {
      name: "Format Date",
      value: plugToolFormatDateOperation,
      description: "Format a date value.",
      action: "Format date",
    },
    {
      name: "Parse Date",
      value: plugToolParseDateOperation,
      description: "Parse a date value into ISO and timestamp outputs.",
      action: "Parse date",
    },
    {
      name: "Add Business Days",
      value: plugToolAddBusinessDaysOperation,
      description: "Add business days to a date.",
      action: "Add business days",
    },
    {
      name: "Format Currency",
      value: plugToolFormatCurrencyOperation,
      description: "Format a number as currency.",
      action: "Format currency",
    },
    {
      name: "Number to Words",
      value: plugToolNumberToWordsOperation,
      description: "Convert a number to words.",
      action: "Convert number to words",
    },
    {
      name: "Build Socket Event Payload",
      value: plugToolBuildSocketEventPayloadOperation,
      description: "Build a Plug custom socket event payload object.",
      action: "Build socket event payload",
    },
    {
      name: "Validate Client Token",
      value: plugToolValidateClientTokenOperation,
      description: "Validate the basic shape of a Plug client token.",
      action: "Validate client token",
    },
    {
      name: "Validate Agent Context",
      value: plugToolValidateAgentContextOperation,
      description: "Validate Plug agent context inputs.",
      action: "Validate agent context",
    },
    {
      name: "Build SQL Request",
      value: plugToolBuildSqlRequestOperation,
      description: "Build a normalized SQL request object.",
      action: "Build SQL request",
    },
    {
      name: "Parse SQL Rows",
      value: plugToolParseSqlRowsOperation,
      description: "Parse SQL rows and summarize columns.",
      action: "Parse SQL rows",
    },
    {
      name: "Generate Access Request Summary",
      value: plugToolGenerateAccessRequestSummaryOperation,
      description: "Create a compact summary for a Plug access request.",
      action: "Generate access request summary",
    },
    {
      name: "Publish Socket Event",
      value: plugToolPublishSocketEventOperation,
      description: "Publish a client:custom.* event through Plug.",
      action: "Publish a socket event",
    },
    {
      name: "Wait for Socket Event",
      value: plugToolWaitForSocketEventOperation,
      description:
        "Official tool-session path for listening to the next matching client:custom.* event.",
      action: "Wait for a socket event",
    },
  ],
});

export const buildPlugToolsCategoryProperty = (): INodeProperties => ({
  displayName: "Tool Category",
  name: "toolCategory",
  type: "options",
  default: plugToolCategoryDocuments,
  noDataExpression: true,
  options: [...plugToolCategoryOptions],
  description: "Choose the group of tools to show.",
});

export const buildPlugToolsOperationProperties = (
  options: PlugToolsPropertiesOptions,
): INodeProperties[] => {
  const operationProperty = buildPlugToolsOperationProperty();
  const operationOptions = (operationProperty.options ?? []).filter((option) => {
    if (
      "value" in option &&
      option.value === plugToolWaitForSocketEventOperation &&
      !options.supportsSocketListen
    ) {
      return false;
    }

    return true;
  });

  return plugToolCategoryOptions.map((categoryOption) => {
    const categoryOperations = new Set<string>(
      plugToolOperationsByCategory[categoryOption.value],
    );

    return addToolCategoryDisplayOption(
      {
        ...operationProperty,
        default: plugToolOperationsByCategory[categoryOption.value][0],
        options: operationOptions.filter(
          (option) => "value" in option && categoryOperations.has(String(option.value)),
        ),
      },
      categoryOption.value,
    );
  });
};
