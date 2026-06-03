import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import {
  addOperationDisplayOption,
  buildCommonDescription,
  plugToolGenerateBarcodeOperation,
  type PlugToolNodeDescriptionOptions,
} from "./plugToolsDescriptionCommon";

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
