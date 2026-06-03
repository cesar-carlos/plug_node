import type { INodeProperties, INodeTypeDescription } from "n8n-workflow";
import {
  addOperationDisplayOption,
  buildCommonDescription,
  plugToolHtmlToPdfOperation,
  type PlugToolNodeDescriptionOptions,
} from "./plugToolsDescriptionCommon";

export const plugToolsPdfOptions: INodeProperties = {
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

export const plugToolsBrowserOptions: INodeProperties = {
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
    plugToolsBrowserOptions,
    plugToolsPdfOptions,
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
