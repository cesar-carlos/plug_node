import { Buffer } from "node:buffer";

import { describe, expect, it, vi } from "vitest";
import type {
  IBinaryData,
  IExecuteFunctions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";

import {
  executePlugToolsBarcodeNode,
  executePlugToolsPdfNode,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/n8n/plugToolsExecution";
import type { HtmlToPdfRenderer } from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/tools/pdf";

const defaultNode: INode = {
  id: "plug-tools-node",
  name: "Plug Tools",
  type: "plugTools",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

interface PreparedBinary {
  readonly buffer: Buffer;
  readonly fileName?: string;
  readonly mimeType?: string;
}

interface ToolContextOptions {
  readonly parameters: Record<string, unknown>;
  readonly inputData?: INodeExecutionData[];
  readonly continueOnFail?: boolean;
}

const createToolContext = (
  options: ToolContextOptions,
): IExecuteFunctions & {
  readonly preparedBinaries: PreparedBinary[];
  readonly prepareBinaryDataMock: ReturnType<typeof vi.fn>;
} => {
  const preparedBinaries: PreparedBinary[] = [];
  const prepareBinaryDataMock = vi.fn(
    async (
      buffer: Buffer,
      fileName?: string,
      mimeType?: string,
    ): Promise<IBinaryData> => {
      preparedBinaries.push({ buffer, fileName, mimeType });
      return {
        data: `binary-${preparedBinaries.length}`,
        mimeType: mimeType ?? "application/octet-stream",
        ...(fileName ? { fileName } : {}),
        fileSize: String(buffer.length),
      };
    },
  );

  const context = {
    helpers: {
      prepareBinaryData: prepareBinaryDataMock,
    },
    continueOnFail: () => options.continueOnFail ?? false,
    getInputData: () => options.inputData ?? [{ json: { input: true } }],
    getNode: () => defaultNode,
    getNodeParameter: (
      name: string,
      itemIndex: number,
      fallbackValue?: unknown,
    ): unknown => {
      if (name in options.parameters) {
        const value = options.parameters[name];
        if (Array.isArray(value)) {
          return value[itemIndex] ?? fallbackValue;
        }

        return value;
      }

      return fallbackValue;
    },
    preparedBinaries,
    prepareBinaryDataMock,
  };

  return context as unknown as IExecuteFunctions & {
    readonly preparedBinaries: PreparedBinary[];
    readonly prepareBinaryDataMock: ReturnType<typeof vi.fn>;
  };
};

describe("Plug tools execution", () => {
  it("renders HTML to PDF with an injected renderer and returns binary output", async () => {
    const renderer: HtmlToPdfRenderer = {
      render: vi.fn(async (input) => {
        expect(input.html).toContain("<h1>Invoice</h1>");
        expect(input.browser).toMatchObject({
          channel: "chrome",
          enableJavaScript: false,
        });
        expect(input.pdf).toMatchObject({
          format: "A4",
          printBackground: true,
          waitUntil: "domcontentloaded",
          media: "screen",
          renderDelayMs: 25,
        });
        expect(input.html).toContain("<style>body { color: red; }</style>");
        return Buffer.from("%PDF-1.7\n");
      }),
      close: vi.fn(async () => undefined),
    };
    const context = createToolContext({
      parameters: {
        html: "<!doctype html><html><body><h1>Invoice</h1></body></html>",
        css: "body { color: red; }",
        fileName: "invoice",
        outputBinaryProperty: "pdf",
        browserOptions: {
          browserChannel: "chrome",
          timeoutMs: 1000,
          enableJavaScript: false,
        },
        pdfOptions: {
          format: "A4",
          printBackground: true,
          waitUntil: "domcontentloaded",
          media: "screen",
          renderDelayMs: 25,
        },
        includePlugToolsMetadata: true,
        metadataProperty: "pdfMeta",
      },
    });

    const output = await executePlugToolsPdfNode(context, {
      nodeDisplayName: "Plug Database PDF",
      renderer,
    });

    expect(output[0][0].json).toMatchObject({
      input: true,
      pdfMeta: {
        operation: "htmlToPdf",
        fileName: "invoice.pdf",
        sizeBytes: 9,
        durationMs: expect.any(Number),
        outputBinaryProperty: "pdf",
      },
    });
    expect(output[0][0].binary?.pdf).toMatchObject({
      mimeType: "application/pdf",
      fileName: "invoice.pdf",
    });
    expect(context.preparedBinaries[0]).toMatchObject({
      fileName: "invoice.pdf",
      mimeType: "application/pdf",
    });
    expect(renderer.close).toHaveBeenCalledOnce();
  });

  it("serializes invalid PDF browser configuration when continueOnFail is enabled", async () => {
    const renderer: HtmlToPdfRenderer = {
      render: vi.fn(async () => Buffer.from("%PDF-1.7\n")),
      close: vi.fn(async () => undefined),
    };
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        html: "<html><body>Report</body></html>",
        css: "",
        fileName: "report.pdf",
        outputBinaryProperty: "data",
        browserOptions: {
          browserChannel: "safari",
        },
        pdfOptions: {},
      },
    });

    const output = await executePlugToolsPdfNode(context, {
      nodeDisplayName: "Plug Database PDF",
      renderer,
    });

    expect(renderer.render).not.toHaveBeenCalled();
    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "Browser Channel must be chrome, msedge, or chromium",
    });
  });

  it("generates QR codes as PNG binary data", async () => {
    const context = createToolContext({
      parameters: {
        text: "https://example.com",
        barcodeType: "qrcode",
        outputFormat: "png",
        fileName: "qr",
        outputBinaryProperty: "qr",
        renderOptions: {
          scale: 2,
          maxTextSizeBytes: 4096,
          maxOutputSizeBytes: 10000000,
        },
        advancedOptionsJson: "{}",
        includeBase64Json: true,
        base64OutputProperty: "qrBase64",
        includePlugToolsMetadata: true,
        metadataProperty: "barcodeMeta",
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Barcode",
    });

    expect(output[0][0].json).toMatchObject({
      barcodeMeta: {
        operation: "generateCode",
        barcodeType: "qrcode",
        outputFormat: "png",
        fileName: "qr.png",
        sizeBytes: expect.any(Number),
        durationMs: expect.any(Number),
      },
      qrBase64: expect.any(String),
    });
    expect(output[0][0].binary?.qr).toMatchObject({
      mimeType: "image/png",
      fileName: "qr.png",
    });
    expect([...context.preparedBinaries[0].buffer.subarray(0, 4)]).toEqual([
      0x89, 0x50, 0x4e, 0x47,
    ]);
  });

  it("generates Code128 as SVG binary data", async () => {
    const context = createToolContext({
      parameters: {
        text: "0123456789",
        barcodeType: "code128",
        outputFormat: "svg",
        outputBinaryProperty: "barcode",
        renderOptions: {
          scale: 2,
          height: 10,
          includeText: true,
          textXAlign: "center",
        },
        advancedOptionsJson: "{}",
        includePlugToolsMetadata: true,
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Barcode",
    });

    expect(output[0][0].binary?.barcode).toMatchObject({
      mimeType: "image/svg+xml",
      fileName: "barcode.svg",
    });
    expect(context.preparedBinaries[0].buffer.toString("utf8")).toContain("<svg");
  });

  it("serializes invalid barcode options when continueOnFail is enabled", async () => {
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        text: "payload",
        barcodeType: "not-a-real-code",
        outputFormat: "png",
        fileName: "bad",
        outputBinaryProperty: "data",
        renderOptions: {},
        advancedOptionsJson: "{}",
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Barcode",
    });

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message:
        "Barcode Type must be qrcode, code128, ean13, ean8, upca, datamatrix, pdf417, or azteccode",
    });
  });

  it("validates numeric barcode formats before rendering", async () => {
    const context = createToolContext({
      continueOnFail: true,
      parameters: {
        text: "not-digits",
        barcodeType: "ean13",
        outputFormat: "png",
        fileName: "bad",
        outputBinaryProperty: "data",
        renderOptions: {},
        advancedOptionsJson: "{}",
      },
    });

    const output = await executePlugToolsBarcodeNode(context, {
      nodeDisplayName: "Plug Database Advanced Barcode",
    });

    expect(output[0][0].json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "EAN-13 text must contain 12 or 13 digits",
    });
    expect(context.prepareBinaryDataMock).not.toHaveBeenCalled();
  });
});
