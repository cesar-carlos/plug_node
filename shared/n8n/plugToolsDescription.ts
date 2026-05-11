import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import { NodeConnectionTypes } from "n8n-workflow";

export interface PlugToolNodeDescriptionOptions {
  readonly displayName: string;
  readonly technicalName: string;
  readonly iconBaseName: string;
  readonly description: string;
}

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
        "Optional absolute path to Chrome or Chromium. Overrides PLUG_TOOLS_CHROME_EXECUTABLE_PATH and Browser Channel.",
    },
    {
      displayName: "Browser Channel",
      name: "browserChannel",
      type: "options",
      default: "chrome",
      options: [
        { name: "Chrome", value: "chrome" },
        { name: "Chromium", value: "chromium" },
        { name: "Microsoft Edge", value: "msedge" },
      ],
      description:
        "Installed browser channel to use when no executable path is provided.",
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
  ]);

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
  ]);
