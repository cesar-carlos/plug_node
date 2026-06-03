import type { INodeProperties } from "n8n-workflow";

import {
  addOperationDisplayOption,
  binaryInputProperty,
  maxInputSizeProperty,
  outputBinaryProperty,
  outputJsonProperty,
  plugToolExtractPdfTextOperation,
  plugToolMarkdownToPdfOperation,
  plugToolMergePdfsOperation,
  plugToolSplitPdfOperation,
  plugToolTextToPdfOperation,
  toolTextField,
} from "./plugToolsDescriptionCommon";
import { plugToolsBrowserOptions, plugToolsPdfOptions } from "./plugToolsDescriptionPdf";

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
      plugToolsBrowserOptions,
      plugToolsPdfOptions,
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
