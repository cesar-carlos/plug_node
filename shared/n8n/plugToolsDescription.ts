import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  type PayloadFrameCompression,
} from "../contracts/api";
import {
  defaultBinaryPropertyPrefix,
  defaultManualListenTimeoutMs,
  defaultSocketEventAckTimeoutMs,
  defaultSocketEventListenTimeoutMaxMs,
} from "../contracts/custom-socket-events";

export interface PlugToolNodeDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly iconBaseName: string;
  readonly description: string;
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

type PlugToolCategory =
  | typeof plugToolCategoryDocuments
  | typeof plugToolCategoryImage
  | typeof plugToolCategoryIdentity
  | typeof plugToolCategoryData
  | typeof plugToolCategorySecurity
  | typeof plugToolCategoryDateValue
  | typeof plugToolCategoryPlugSpecific
  | typeof plugToolCategorySocket;

const plugToolOperationsByCategory = {
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

const plugToolCategoryOptions: readonly {
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
    description: "Publish or wait for Plug custom socket events.",
  },
];

const addOperationDisplayOption = (
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

const addToolCategoryDisplayOption = (
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

const buildCommonDescription = (
  options: PlugToolNodeDescriptionOptions,
  properties: INodeProperties[],
): INodeTypeDescription => ({
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
  usableAsTool: true,
  inputs: [NodeConnectionTypes.Main],
  outputs: [NodeConnectionTypes.Main],
  properties,
});

const pdfOptions: INodeProperties = {
  displayName: "PDF Options",
  name: "pdfOptions",
  type: "collection",
  placeholder: "Add PDF option",
  default: {},
  options: [
    {
      displayName: "Format",
      name: "format",
      type: "options",
      default: "A4",
      options: [
        { name: "A3", value: "A3" },
        { name: "A4", value: "A4" },
        { name: "A5", value: "A5" },
        { name: "Legal", value: "Legal" },
        { name: "Letter", value: "Letter" },
      ],
    },
    {
      displayName: "Landscape",
      name: "landscape",
      type: "boolean",
      default: false,
      description: "Whether to render the PDF in landscape orientation.",
    },
    {
      displayName: "Print Background",
      name: "printBackground",
      type: "boolean",
      default: true,
      description: "Whether to include CSS background colors and images.",
    },
    {
      displayName: "Prefer CSS Page Size",
      name: "preferCSSPageSize",
      type: "boolean",
      default: false,
      description: "Whether CSS @page size should override the selected format.",
    },
    {
      displayName: "Scale",
      name: "scale",
      type: "number",
      default: 1,
      typeOptions: {
        minValue: 0.1,
        maxValue: 2,
      },
      description: "Scale of the rendered page. Must be between 0.1 and 2.",
    },
    {
      displayName: "Wait Until",
      name: "waitUntil",
      type: "options",
      default: "load",
      options: [
        { name: "Load", value: "load" },
        { name: "DOM Content Loaded", value: "domcontentloaded" },
        { name: "Network Idle", value: "networkidle" },
      ],
      description: "Page readiness event to wait for before printing the PDF.",
    },
    {
      displayName: "PDF Media",
      name: "media",
      type: "options",
      default: "print",
      options: [
        { name: "Print", value: "print" },
        { name: "Screen", value: "screen" },
      ],
      description: "CSS media type to emulate before printing the PDF.",
    },
    {
      displayName: "Render Delay (ms)",
      name: "renderDelayMs",
      type: "number",
      default: 0,
      typeOptions: {
        minValue: 0,
      },
      description: "Extra time to wait after the page is ready before printing the PDF.",
    },
    {
      displayName: "Max HTML Size Bytes",
      name: "maxHtmlSizeBytes",
      type: "number",
      default: 1000000,
      typeOptions: {
        minValue: 1,
      },
      description: "Maximum UTF-8 byte size for HTML plus optional CSS.",
    },
    {
      displayName: "Max PDF Output Size Bytes",
      name: "maxOutputSizeBytes",
      type: "number",
      default: 25000000,
      typeOptions: {
        minValue: 1,
      },
      description: "Maximum generated PDF size in bytes.",
    },
    {
      displayName: "Margin Top",
      name: "marginTop",
      type: "string",
      default: "20mm",
    },
    {
      displayName: "Margin Right",
      name: "marginRight",
      type: "string",
      default: "20mm",
    },
    {
      displayName: "Margin Bottom",
      name: "marginBottom",
      type: "string",
      default: "20mm",
    },
    {
      displayName: "Margin Left",
      name: "marginLeft",
      type: "string",
      default: "20mm",
    },
    {
      displayName: "Header Template",
      name: "headerTemplate",
      type: "string",
      default: "",
      typeOptions: {
        rows: 3,
      },
      description:
        "Optional HTML template for the PDF header. Chromium pageNumber and totalPages classes are supported.",
    },
    {
      displayName: "Footer Template",
      name: "footerTemplate",
      type: "string",
      default: "",
      typeOptions: {
        rows: 3,
      },
      description:
        "Optional HTML template for the PDF footer. Chromium pageNumber and totalPages classes are supported.",
    },
  ],
};

const browserOptions: INodeProperties = {
  displayName: "Browser Options",
  name: "browserOptions",
  type: "collection",
  placeholder: "Add browser option",
  default: {},
  options: [
    {
      displayName: "Browser Executable Path",
      name: "browserExecutablePath",
      type: "string",
      default: "",
      description:
        "Optional absolute path to Chrome or Chromium. Overrides PLUG_TOOLS_BROWSER_EXECUTABLE_PATH, PLUG_TOOLS_CHROME_EXECUTABLE_PATH, and Browser Channel.",
    },
    {
      displayName: "Browser Channel",
      name: "browserChannel",
      type: "options",
      default: "auto",
      options: [
        { name: "Auto", value: "auto" },
        { name: "Chromium", value: "chromium" },
        { name: "Chrome", value: "chrome" },
        { name: "Microsoft Edge", value: "msedge" },
      ],
      description:
        "Browser to use when no executable path is provided. Auto uses Playwright-managed Chromium, then common installed Chrome/Chromium paths if the bundled browser is unavailable.",
    },
    {
      displayName: "Timeout (ms)",
      name: "timeoutMs",
      type: "number",
      default: 30000,
      typeOptions: {
        minValue: 1,
      },
      description: "Browser launch and page render timeout in milliseconds.",
    },
    {
      displayName: "Enable JavaScript",
      name: "enableJavaScript",
      type: "boolean",
      default: false,
      description:
        "Whether to allow JavaScript while rendering the HTML. External network and file URLs remain blocked.",
    },
  ],
};

const barcodeRenderOptions: INodeProperties = {
  displayName: "Render Options",
  name: "renderOptions",
  type: "collection",
  placeholder: "Add render option",
  default: {},
  options: [
    {
      displayName: "Scale",
      name: "scale",
      type: "number",
      default: 3,
      typeOptions: {
        minValue: 1,
      },
      description: "Pixel scaling factor for generated PNG or SVG output.",
    },
    {
      displayName: "Height",
      name: "height",
      type: "number",
      default: 0,
      typeOptions: {
        minValue: 0,
      },
      description:
        "Optional bar height in millimeters for linear barcodes. Leave 0 for the encoder default.",
    },
    {
      displayName: "Max Text Size Bytes",
      name: "maxTextSizeBytes",
      type: "number",
      default: 4096,
      typeOptions: {
        minValue: 1,
      },
      description: "Maximum UTF-8 byte size for the text to encode.",
    },
    {
      displayName: "Max Output Size Bytes",
      name: "maxOutputSizeBytes",
      type: "number",
      default: 10000000,
      typeOptions: {
        minValue: 1,
      },
      description: "Maximum generated barcode or QR code image size in bytes.",
    },
    {
      displayName: "Include Text",
      name: "includeText",
      type: "boolean",
      default: false,
      description: "Whether to include human-readable text below supported barcodes.",
    },
    {
      displayName: "Text X Align",
      name: "textXAlign",
      type: "options",
      default: "center",
      options: [
        { name: "Center", value: "center" },
        { name: "Left", value: "left" },
        { name: "Right", value: "right" },
      ],
      displayOptions: {
        show: {
          includeText: [true],
        },
      },
      description: "Text alignment for human-readable barcode text.",
    },
    {
      displayName: "QR Error Correction",
      name: "qrErrorCorrection",
      type: "options",
      default: "M",
      options: [
        { name: "Low", value: "L" },
        { name: "Medium", value: "M" },
        { name: "Quartile", value: "Q" },
        { name: "High", value: "H" },
      ],
      description: "QR Code error correction level. Only applies to QR Code output.",
    },
    {
      displayName: "Foreground Color",
      name: "foregroundColor",
      type: "string",
      default: "",
      placeholder: "000000",
      description: "Optional 6-digit hex color for bars or QR modules.",
    },
    {
      displayName: "Background Color",
      name: "backgroundColor",
      type: "string",
      default: "",
      placeholder: "ffffff",
      description: "Optional 6-digit hex background color.",
    },
  ],
};

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
      description: "Wait for the next matching client:custom.* event.",
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

export const buildPlugToolsPdfNodeDescription = (
  options: PlugToolNodeDescriptionOptions,
): INodeTypeDescription =>
  buildCommonDescription(options, [
    {
      displayName: "Operation",
      name: "operation",
      type: "options",
      default: "htmlToPdf",
      noDataExpression: true,
      options: [
        {
          name: "HTML to PDF",
          value: "htmlToPdf",
          description: "Render an HTML string to a PDF binary file.",
          action: "Render HTML to PDF",
        },
      ],
    },
    ...buildPlugToolsPdfProperties(),
  ]);

export const buildPlugToolsPdfProperties = (): INodeProperties[] => {
  const properties: INodeProperties[] = [
    {
      displayName: "HTML",
      name: "html",
      type: "string",
      default: "<!doctype html><html><body><h1>Plug PDF</h1></body></html>",
      required: true,
      typeOptions: {
        rows: 12,
      },
      description: "HTML string to render into the PDF.",
    },
    {
      displayName: "CSS",
      name: "css",
      type: "string",
      default: "",
      typeOptions: {
        rows: 6,
      },
      description: "Optional CSS to inject into the HTML document before rendering.",
    },
    {
      displayName: "File Name",
      name: "fileName",
      type: "string",
      default: "document.pdf",
      description: "Name of the generated PDF file.",
    },
    {
      displayName: "Output Binary Property",
      name: "outputBinaryProperty",
      type: "string",
      default: "data",
      description: "Binary property where the generated PDF should be stored.",
    },
    browserOptions,
    pdfOptions,
    {
      displayName: "Include Plug Tools Metadata",
      name: "includePlugToolsMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plugTools object with generation metadata in output JSON.",
    },
    {
      displayName: "Metadata Property",
      name: "metadataProperty",
      type: "string",
      default: "__plugTools",
      displayOptions: {
        show: {
          includePlugToolsMetadata: [true],
        },
      },
      description: "JSON property where generation metadata should be stored.",
    },
  ];

  return properties.map((property) =>
    addOperationDisplayOption(property, plugToolHtmlToPdfOperation),
  );
};

export const buildPlugToolsBarcodeNodeDescription = (
  options: PlugToolNodeDescriptionOptions,
): INodeTypeDescription =>
  buildCommonDescription(options, [
    {
      displayName: "Operation",
      name: "operation",
      type: "options",
      default: "generateCode",
      noDataExpression: true,
      options: [
        {
          name: "Generate Code",
          value: "generateCode",
          description: "Generate a QR code or barcode binary file.",
          action: "Generate a QR code or barcode",
        },
      ],
    },
    ...buildPlugToolsBarcodeProperties(),
  ]);

export const buildPlugToolsBarcodeProperties = (): INodeProperties[] => {
  const properties: INodeProperties[] = [
    {
      displayName: "Text",
      name: "text",
      type: "string",
      default: "",
      required: true,
      typeOptions: {
        rows: 4,
      },
      description: "Text to encode in the QR code or barcode.",
    },
    {
      displayName: "Barcode Type",
      name: "barcodeType",
      type: "options",
      default: "qrcode",
      options: [
        { name: "QR Code", value: "qrcode" },
        { name: "Code 128", value: "code128" },
        { name: "EAN-13", value: "ean13" },
        { name: "EAN-8", value: "ean8" },
        { name: "UPC-A", value: "upca" },
        { name: "Data Matrix", value: "datamatrix" },
        { name: "PDF417", value: "pdf417" },
        { name: "Aztec Code", value: "azteccode" },
      ],
      description: "Barcode Writer in Pure PostScript encoder name.",
    },
    {
      displayName: "Output Format",
      name: "outputFormat",
      type: "options",
      default: "png",
      options: [
        { name: "PNG", value: "png" },
        { name: "SVG", value: "svg" },
      ],
      description: "Image format to output as n8n binary data.",
    },
    {
      displayName: "File Name",
      name: "fileName",
      type: "string",
      default: "barcode",
      description: "Name of the generated image file.",
    },
    {
      displayName: "Output Binary Property",
      name: "outputBinaryProperty",
      type: "string",
      default: "data",
      description: "Binary property where the generated image should be stored.",
    },
    barcodeRenderOptions,
    {
      displayName: "Advanced Options JSON",
      name: "advancedOptionsJson",
      type: "json",
      default: "{}",
      typeOptions: {
        rows: 5,
      },
      description:
        "Optional bwip-js options merged into rendering. Values must be strings, numbers, or booleans.",
    },
    {
      displayName: "Include Base64 JSON",
      name: "includeBase64Json",
      type: "boolean",
      default: false,
      description:
        "Whether to include the generated image as base64 in output JSON in addition to binary data.",
    },
    {
      displayName: "Base64 Output Property",
      name: "base64OutputProperty",
      type: "string",
      default: "generatedCodeBase64",
      displayOptions: {
        show: {
          includeBase64Json: [true],
        },
      },
      description: "JSON property where the optional base64 image should be stored.",
    },
    {
      displayName: "Include Plug Tools Metadata",
      name: "includePlugToolsMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plugTools object with generation metadata in output JSON.",
    },
    {
      displayName: "Metadata Property",
      name: "metadataProperty",
      type: "string",
      default: "__plugTools",
      displayOptions: {
        show: {
          includePlugToolsMetadata: [true],
        },
      },
      description: "JSON property where generation metadata should be stored.",
    },
  ];

  return properties.map((property) =>
    addOperationDisplayOption(property, plugToolGenerateBarcodeOperation),
  );
};

export const buildPlugToolsSocketEventProperties = (
  options: PlugToolsPropertiesOptions,
): INodeProperties[] => {
  const publishOperation = options.operation ?? plugToolPublishSocketEventOperation;
  const publishProperties: INodeProperties[] = [
    {
      displayName: "Publish Channel",
      name: "publishChannel",
      type: "options",
      default: "rest",
      options: [
        {
          name: "REST",
          value: "rest",
          description: "Publish through POST /client/me/socket-events",
          action: "Publish through REST",
        },
        ...(options.supportsSocketPublish
          ? [
              {
                name: "Socket",
                value: "socket",
                description: "Publish through socket:event.publish on /consumers",
                action: "Publish through Socket",
              },
            ]
          : []),
      ],
      description: "Transport used to publish the custom event.",
    },
    {
      displayName: "Event Name",
      name: "eventName",
      type: "string",
      default: "client:custom.status.changed",
      required: true,
      description: "Exact custom event name to publish. Must start with client:custom.",
    },
    {
      displayName: "Payload JSON",
      name: "payloadJson",
      type: "json",
      default: "{}",
      required: true,
      description: "JSON payload delivered to subscribers. Use null for a null payload.",
    },
    {
      displayName: "Attachments",
      name: "attachments",
      type: "fixedCollection",
      placeholder: "Add attachment",
      default: {},
      typeOptions: {
        multipleValues: true,
      },
      options: [
        {
          displayName: "Attachment",
          name: "values",
          values: [
            {
              displayName: "Binary Property",
              name: "binaryPropertyName",
              type: "string",
              default: "data",
              required: true,
              description:
                "Name of the binary property to publish as an inline socket event attachment",
            },
          ],
        },
      ],
    },
    {
      displayName: "Payload Frame Compression",
      name: "payloadFrameCompression",
      type: "options",
      default: "default" satisfies PayloadFrameCompression,
      options: [
        { name: "Always", value: "always" },
        { name: "Default", value: "default" },
        { name: "None", value: "none" },
      ],
      description: "Compression preference used by Plug when emitting the PayloadFrame.",
    },
    {
      displayName: "Idempotency Key",
      name: "idempotencyKey",
      type: "string",
      default: "",
      description:
        "Optional retry key. Reusing the same key with the same body returns the original accepted response.",
    },
    {
      displayName: "Timeout (MS)",
      name: "timeoutMs",
      type: "number",
      default: DEFAULT_REQUEST_TIMEOUT_MS,
      typeOptions: {
        minValue: 1,
      },
      description:
        "HTTP timeout for REST publishing. Socket publishing uses Socket ACK Timeout when set.",
    },
    ...(options.supportsSocketPublish
      ? [
          {
            displayName: "Socket ACK Timeout (MS)",
            name: "socketAckTimeoutMs",
            type: "number",
            default: defaultSocketEventAckTimeoutMs,
            typeOptions: {
              minValue: 1,
            },
            displayOptions: {
              show: {
                publishChannel: ["socket"],
              },
            },
            description:
              "Time to wait for connection:ready and socket:event.published when publishing via Socket.",
          } satisfies INodeProperties,
        ]
      : []),
    {
      displayName: "Include Plug Metadata",
      name: "includePlugMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plug object with channel and event metadata in the output.",
    },
  ];

  const properties = publishProperties.map((property) =>
    addOperationDisplayOption(property, publishOperation),
  );

  if (options.operation !== undefined || !options.supportsSocketListen) {
    return properties;
  }

  const waitProperties: INodeProperties[] = [
    {
      displayName: "Event Name",
      name: "eventName",
      type: "string",
      default: "client:custom.status.changed",
      required: true,
      description: "Exact custom event name to wait for. Must start with client:custom.",
    },
    {
      displayName: "Listen Timeout (MS)",
      name: "listenTimeoutMs",
      type: "number",
      default: defaultManualListenTimeoutMs,
      typeOptions: {
        minValue: 1,
        maxValue: defaultSocketEventListenTimeoutMaxMs,
      },
      description: `Maximum time to wait for the first matching socket event after subscribing. Max ${defaultSocketEventListenTimeoutMaxMs} ms.`,
    },
    {
      displayName: "Socket ACK Timeout (MS)",
      name: "socketAckTimeoutMs",
      type: "number",
      default: defaultSocketEventAckTimeoutMs,
      typeOptions: {
        minValue: 1,
      },
      description:
        "Time to wait for connection:ready and socket:event.subscribe acknowledgements.",
    },
    {
      displayName: "Binary Property Prefix",
      name: "binaryPropertyPrefix",
      type: "string",
      default: defaultBinaryPropertyPrefix,
      description: "Prefix for binary properties created from inline event attachments.",
    },
    {
      displayName: "Require Payload Signature",
      name: "requirePayloadSignature",
      type: "boolean",
      default: false,
      description: "Whether inbound PayloadFrames must include a valid HMAC signature.",
    },
    {
      displayName: "Include Plug Metadata",
      name: "includePlugMetadata",
      type: "boolean",
      default: true,
      description:
        "Whether to include the __plug object with channel and event metadata in the output.",
    },
  ];

  return [
    ...properties,
    ...waitProperties.map((property) =>
      addOperationDisplayOption(property, plugToolWaitForSocketEventOperation),
    ),
  ];
};

const binaryInputProperty = (operation: string): INodeProperties =>
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

const maxInputSizeProperty = (
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

const outputBinaryProperty = (operation: string): INodeProperties =>
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

const outputJsonProperty = (
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

const toolTextField = (
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

const passwordField = (
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

const imageOutputFormatOption: INodeProperties = {
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

const imageQualityOption: INodeProperties = {
  displayName: "Quality",
  name: "quality",
  type: "number",
  default: 80,
  typeOptions: { minValue: 1, maxValue: 100 },
};

const imageMaxOutputSizeOption: INodeProperties = {
  displayName: "Max Output Size Bytes",
  name: "maxOutputSizeBytes",
  type: "number",
  default: 25_000_000,
  typeOptions: { minValue: 1 },
};

const imageOptionsProperty = (
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

export const buildPlugToolsDocumentProperties = (): INodeProperties[] => [
  ...[
    toolTextField(
      plugToolMarkdownToPdfOperation,
      "markdown",
      "Markdown",
      "# Plug PDF",
      12,
    ),
    toolTextField(plugToolTextToPdfOperation, "text", "Text", "Plug PDF", 12),
  ],
  ...[plugToolMarkdownToPdfOperation, plugToolTextToPdfOperation].flatMap((operation) =>
    [
      {
        displayName: "File Name",
        name: "fileName",
        type: "string",
        default: "document.pdf",
        description: "Name of the generated PDF file.",
      },
      outputBinaryProperty(operation),
      browserOptions,
      pdfOptions,
      {
        displayName: "Include Plug Tools Metadata",
        name: "includePlugToolsMetadata",
        type: "boolean",
        default: true,
      },
      {
        displayName: "Metadata Property",
        name: "metadataProperty",
        type: "string",
        default: "__plugTools",
        displayOptions: { show: { includePlugToolsMetadata: [true] } },
      },
    ].map((property) =>
      addOperationDisplayOption(property as INodeProperties, operation),
    ),
  ),
  binaryInputProperty(plugToolMergePdfsOperation),
  maxInputSizeProperty(plugToolMergePdfsOperation),
  {
    displayName: "Additional PDFs",
    name: "pdfAttachments",
    type: "fixedCollection",
    placeholder: "Add PDF",
    default: {},
    typeOptions: { multipleValues: true },
    options: [
      {
        displayName: "PDF",
        name: "values",
        values: [
          {
            displayName: "Binary Property",
            name: "binaryPropertyName",
            type: "string",
            default: "data",
          },
        ],
      },
    ],
    displayOptions: { show: { operation: [plugToolMergePdfsOperation] } },
  },
  outputBinaryProperty(plugToolMergePdfsOperation),
  binaryInputProperty(plugToolSplitPdfOperation),
  maxInputSizeProperty(plugToolSplitPdfOperation),
  toolTextField(plugToolSplitPdfOperation, "pageRange", "Page Range", "", 1),
  outputBinaryProperty(plugToolSplitPdfOperation),
  binaryInputProperty(plugToolExtractPdfTextOperation),
  maxInputSizeProperty(plugToolExtractPdfTextOperation),
  outputJsonProperty(plugToolExtractPdfTextOperation, "pdfText"),
];

export const buildPlugToolsImageProperties = (): INodeProperties[] => [
  binaryInputProperty(plugToolResizeImageOperation),
  maxInputSizeProperty(plugToolResizeImageOperation),
  outputBinaryProperty(plugToolResizeImageOperation),
  imageOptionsProperty(plugToolResizeImageOperation, [
    {
      displayName: "Width",
      name: "width",
      type: "number",
      default: 0,
      typeOptions: { minValue: 0 },
    },
    {
      displayName: "Height",
      name: "height",
      type: "number",
      default: 0,
      typeOptions: { minValue: 0 },
    },
    imageOutputFormatOption,
    imageQualityOption,
  ]),
  binaryInputProperty(plugToolConvertImageOperation),
  maxInputSizeProperty(plugToolConvertImageOperation),
  outputBinaryProperty(plugToolConvertImageOperation),
  imageOptionsProperty(plugToolConvertImageOperation, [
    imageOutputFormatOption,
    imageQualityOption,
  ]),
  binaryInputProperty(plugToolCompressImageOperation),
  maxInputSizeProperty(plugToolCompressImageOperation),
  outputBinaryProperty(plugToolCompressImageOperation),
  imageOptionsProperty(plugToolCompressImageOperation, [
    imageOutputFormatOption,
    imageQualityOption,
  ]),
  binaryInputProperty(plugToolAddImageWatermarkOperation),
  maxInputSizeProperty(plugToolAddImageWatermarkOperation),
  outputBinaryProperty(plugToolAddImageWatermarkOperation),
  imageOptionsProperty(plugToolAddImageWatermarkOperation, [
    {
      displayName: "Watermark Text",
      name: "watermarkText",
      type: "string",
      default: "Watermark",
    },
    {
      displayName: "Watermark Opacity",
      name: "watermarkOpacity",
      type: "number",
      default: 0.4,
      typeOptions: { minValue: 0.01, maxValue: 1 },
    },
    imageOutputFormatOption,
    imageQualityOption,
  ]),
  binaryInputProperty(plugToolCreateThumbnailOperation),
  maxInputSizeProperty(plugToolCreateThumbnailOperation),
  outputBinaryProperty(plugToolCreateThumbnailOperation),
  imageOptionsProperty(plugToolCreateThumbnailOperation, [
    {
      displayName: "Size",
      name: "size",
      type: "number",
      default: 256,
      typeOptions: { minValue: 1 },
    },
    imageOutputFormatOption,
    imageQualityOption,
  ]),
];

export const buildPlugToolsIdentityProperties = (): INodeProperties[] => [
  binaryInputProperty(plugToolReadBarcodeOperation),
  maxInputSizeProperty(plugToolReadBarcodeOperation),
  outputJsonProperty(plugToolReadBarcodeOperation, "barcode"),
  toolTextField(plugToolValidateCpfCnpjOperation, "document", "Document", "", 1),
  outputJsonProperty(plugToolValidateCpfCnpjOperation, "documentValidation"),
  toolTextField(plugToolFormatCpfCnpjOperation, "document", "Document", "", 1),
  outputJsonProperty(plugToolFormatCpfCnpjOperation, "formattedDocument"),
  outputJsonProperty(plugToolGenerateUuidOperation, "uuid"),
];

export const buildPlugToolsDataProperties = (): INodeProperties[] => [
  toolTextField(
    plugToolTransformJsonOperation,
    "jsonataExpression",
    "JSONata Expression",
    "$",
    4,
  ),
  outputJsonProperty(plugToolTransformJsonOperation, "result"),
  toolTextField(plugToolCsvToJsonOperation, "csv", "CSV", "", 8),
  outputJsonProperty(plugToolCsvToJsonOperation, "rows"),
  toolTextField(plugToolJsonToCsvOperation, "json", "JSON", "[]", 8, "json"),
  outputJsonProperty(plugToolJsonToCsvOperation, "csv"),
  toolTextField(plugToolNormalizeTextOperation, "text", "Text", "", 4),
  outputJsonProperty(plugToolNormalizeTextOperation, "text"),
  toolTextField(plugToolExtractRegexFieldsOperation, "text", "Text", "", 4),
  toolTextField(
    plugToolExtractRegexFieldsOperation,
    "regexPattern",
    "Regex Pattern",
    "",
    2,
  ),
  toolTextField(plugToolExtractRegexFieldsOperation, "regexFlags", "Regex Flags", "g", 1),
  outputJsonProperty(plugToolExtractRegexFieldsOperation, "regex"),
  toolTextField(plugToolValidateJsonSchemaOperation, "json", "JSON", "{}", 8, "json"),
  toolTextField(
    plugToolValidateJsonSchemaOperation,
    "jsonSchema",
    "JSON Schema",
    "{}",
    8,
    "json",
  ),
  outputJsonProperty(plugToolValidateJsonSchemaOperation, "schemaValidation"),
];

export const buildPlugToolsSecurityProperties = (): INodeProperties[] => [
  toolTextField(plugToolGenerateHashOperation, "text", "Text", "", 4),
  toolTextField(plugToolGenerateHashOperation, "algorithm", "Algorithm", "sha256", 1),
  outputJsonProperty(plugToolGenerateHashOperation, "hash"),
  toolTextField(plugToolHmacSignOperation, "text", "Text", "", 4),
  passwordField(plugToolHmacSignOperation, "secret", "Secret"),
  toolTextField(plugToolHmacSignOperation, "algorithm", "Algorithm", "sha256", 1),
  outputJsonProperty(plugToolHmacSignOperation, "signature"),
  addOperationDisplayOption(
    {
      displayName: "Mode",
      name: "base64Mode",
      type: "options",
      default: "encode",
      options: [
        { name: "Encode", value: "encode" },
        { name: "Decode", value: "decode" },
      ],
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Encode Input",
      name: "base64EncodeInput",
      type: "options",
      default: "text",
      options: [
        { name: "Text", value: "text" },
        { name: "Binary", value: "binary" },
      ],
      displayOptions: {
        show: {
          base64Mode: ["encode"],
        },
      },
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Text",
      name: "text",
      type: "string",
      default: "",
      required: true,
      typeOptions: {
        rows: 4,
      },
      displayOptions: {
        show: {
          base64Mode: ["encode", "decode"],
          base64EncodeInput: ["text"],
        },
      },
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Decode Output",
      name: "base64DecodeOutput",
      type: "options",
      default: "text",
      options: [
        { name: "Text", value: "text" },
        { name: "Binary", value: "binary" },
      ],
      displayOptions: {
        show: {
          base64Mode: ["decode"],
        },
      },
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Binary Property",
      name: "binaryPropertyName",
      type: "string",
      default: "data",
      displayOptions: {
        show: {
          base64Mode: ["encode"],
          base64EncodeInput: ["binary"],
        },
      },
      description: "Binary property to encode as Base64.",
    },
    plugToolBase64Operation,
  ),
  addOperationDisplayOption(
    {
      displayName: "Output Binary Property",
      name: "outputBinaryProperty",
      type: "string",
      default: "data",
      displayOptions: {
        show: {
          base64Mode: ["decode"],
          base64DecodeOutput: ["binary"],
        },
      },
      description: "Binary property where decoded Base64 data should be stored.",
    },
    plugToolBase64Operation,
  ),
  maxInputSizeProperty(plugToolBase64Operation),
  outputJsonProperty(plugToolBase64Operation, "base64"),
  toolTextField(plugToolJwtDecodeOperation, "jwt", "JWT", "", 4),
  outputJsonProperty(plugToolJwtDecodeOperation, "jwt"),
  toolTextField(plugToolEncryptTextOperation, "text", "Plaintext", "", 4),
  passwordField(plugToolEncryptTextOperation, "passphrase", "Passphrase"),
  outputJsonProperty(plugToolEncryptTextOperation, "encrypted"),
  toolTextField(
    plugToolDecryptTextOperation,
    "encryptedJson",
    "Encrypted JSON",
    "{}",
    8,
    "json",
  ),
  passwordField(plugToolDecryptTextOperation, "passphrase", "Passphrase"),
  outputJsonProperty(plugToolDecryptTextOperation, "plaintext"),
];

export const buildPlugToolsDateValueProperties = (): INodeProperties[] => [
  toolTextField(plugToolFormatDateOperation, "date", "Date", "", 1),
  toolTextField(plugToolFormatDateOperation, "dateFormat", "Date Format", "iso", 1),
  outputJsonProperty(plugToolFormatDateOperation, "date"),
  toolTextField(plugToolParseDateOperation, "date", "Date", "", 1),
  outputJsonProperty(plugToolParseDateOperation, "date"),
  toolTextField(plugToolAddBusinessDaysOperation, "date", "Date", "", 1),
  toolTextField(
    plugToolAddBusinessDaysOperation,
    "businessDays",
    "Business Days",
    "1",
    1,
  ),
  outputJsonProperty(plugToolAddBusinessDaysOperation, "date"),
  toolTextField(plugToolFormatCurrencyOperation, "amount", "Amount", "0", 1),
  toolTextField(plugToolFormatCurrencyOperation, "locale", "Locale", "en-US", 1),
  toolTextField(plugToolFormatCurrencyOperation, "currency", "Currency", "USD", 1),
  outputJsonProperty(plugToolFormatCurrencyOperation, "currency"),
  toolTextField(plugToolNumberToWordsOperation, "number", "Number", "0", 1),
  toolTextField(plugToolNumberToWordsOperation, "locale", "Locale", "en-US", 1),
  outputJsonProperty(plugToolNumberToWordsOperation, "words"),
];

export const buildPlugToolsPlugSpecificProperties = (): INodeProperties[] => [
  toolTextField(
    plugToolBuildSocketEventPayloadOperation,
    "eventName",
    "Event Name",
    "client:custom.status.changed",
    1,
  ),
  toolTextField(
    plugToolBuildSocketEventPayloadOperation,
    "payloadJson",
    "Payload JSON",
    "{}",
    8,
    "json",
  ),
  outputJsonProperty(plugToolBuildSocketEventPayloadOperation, "socketEventPayload"),
  toolTextField(
    plugToolValidateClientTokenOperation,
    "clientToken",
    "Client Token",
    "",
    1,
  ),
  outputJsonProperty(plugToolValidateClientTokenOperation, "clientTokenValidation"),
  toolTextField(plugToolValidateAgentContextOperation, "agentId", "Agent ID", "", 1),
  toolTextField(
    plugToolValidateAgentContextOperation,
    "clientToken",
    "Client Token",
    "",
    1,
  ),
  outputJsonProperty(plugToolValidateAgentContextOperation, "agentContext"),
  toolTextField(plugToolBuildSqlRequestOperation, "agentId", "Agent ID", "", 1),
  toolTextField(plugToolBuildSqlRequestOperation, "sql", "SQL", "select 1", 4),
  toolTextField(
    plugToolBuildSqlRequestOperation,
    "paramsJson",
    "Params JSON",
    "[]",
    4,
    "json",
  ),
  outputJsonProperty(plugToolBuildSqlRequestOperation, "sqlRequest"),
  toolTextField(plugToolParseSqlRowsOperation, "rowsJson", "Rows JSON", "[]", 8, "json"),
  outputJsonProperty(plugToolParseSqlRowsOperation, "sqlRows"),
  toolTextField(
    plugToolGenerateAccessRequestSummaryOperation,
    "accessRequestJson",
    "Access Request JSON",
    "{}",
    8,
    "json",
  ),
  outputJsonProperty(
    plugToolGenerateAccessRequestSummaryOperation,
    "accessRequestSummary",
  ),
];

export const buildPlugToolsProperties = (
  options: PlugToolsPropertiesOptions,
): INodeProperties[] => [
  buildPlugToolsCategoryProperty(),
  ...buildPlugToolsOperationProperties(options),
  ...buildPlugToolsPdfProperties(),
  ...buildPlugToolsDocumentProperties(),
  ...buildPlugToolsImageProperties(),
  ...buildPlugToolsBarcodeProperties(),
  ...buildPlugToolsIdentityProperties(),
  ...buildPlugToolsDataProperties(),
  ...buildPlugToolsSecurityProperties(),
  ...buildPlugToolsDateValueProperties(),
  ...buildPlugToolsPlugSpecificProperties(),
  ...buildPlugToolsSocketEventProperties(options),
];
