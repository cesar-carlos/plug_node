import { Buffer } from "node:buffer";

import { PDFDocument } from "pdf-lib";
import { describe, expect, it, vi } from "vitest";

import {
  plugToolExtractPdfTextOperation,
  plugToolMarkdownToPdfOperation,
  plugToolMergePdfsOperation,
  plugToolSplitPdfOperation,
  plugToolTextToPdfOperation,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsDescription";
import { executePlugToolsDocumentNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsDocumentExecution";
import type { HtmlToPdfRenderer } from "../../packages/n8n-nodes-plug-database/generated/shared/tools/pdf";
import { createPlugToolsExecuteContext } from "../helpers/createPlugToolsExecuteContext";

const buildPdfBuffer = async (pageCount: number): Promise<Buffer> => {
  const document = await PDFDocument.create();
  for (let index = 0; index < pageCount; index += 1) {
    document.addPage();
  }
  return Buffer.from(await document.save());
};

describe("executePlugToolsDocumentNode", () => {
  it("merges the primary PDF with attachment binaries", async () => {
    const primary = await buildPdfBuffer(1);
    const attachment = await buildPdfBuffer(1);
    const context = createPlugToolsExecuteContext({
      binaryBuffer: primary,
      binaryBuffersByProperty: {
        data: primary,
        attachmentPdf: attachment,
      },
      parameters: {
        binaryPropertyName: "data",
        maxInputSizeBytes: 25_000_000,
        outputBinaryProperty: "merged",
        pdfAttachments: {
          values: [{ binaryPropertyName: "attachmentPdf" }],
        },
      },
    });

    const output = await executePlugToolsDocumentNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      plugToolMergePdfsOperation,
    );

    expect(output[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: plugToolMergePdfsOperation,
      inputCount: 2,
      outputBinaryProperty: "merged",
    });
    expect(output[0]?.[0]?.binary?.merged?.mimeType).toBe("application/pdf");
    expect(context.preparedBinaries[0]?.fileName).toBe("merged.pdf");
    expect(context.preparedBinaries[0]?.buffer.length).toBeGreaterThan(primary.length);
  });

  it("splits a PDF into one item per page", async () => {
    const source = await buildPdfBuffer(2);
    const context = createPlugToolsExecuteContext({
      binaryBuffer: source,
      parameters: {
        binaryPropertyName: "data",
        maxInputSizeBytes: 25_000_000,
        outputBinaryProperty: "page",
        pageRange: "",
      },
    });

    const output = await executePlugToolsDocumentNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      plugToolSplitPdfOperation,
    );

    expect(output[0]).toHaveLength(2);
    expect(output[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: plugToolSplitPdfOperation,
      pageNumber: 1,
      outputBinaryProperty: "page",
    });
    expect(output[0]?.[1]?.json.__plugTools).toMatchObject({
      pageNumber: 2,
    });
  });

  it("extracts PDF text into the configured JSON property", async () => {
    const source = await buildPdfBuffer(1);
    const context = createPlugToolsExecuteContext({
      binaryBuffer: source,
      parameters: {
        binaryPropertyName: "data",
        maxInputSizeBytes: 25_000_000,
        outputJsonProperty: "extracted",
      },
    });

    const output = await executePlugToolsDocumentNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      plugToolExtractPdfTextOperation,
    );

    expect(output[0]?.[0]?.json.extracted).toMatchObject({
      pages: expect.any(Array),
      text: expect.any(String),
    });
    expect(output[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: plugToolExtractPdfTextOperation,
      pages: 1,
    });
  });

  it("renders markdown to PDF through the injected HTML renderer", async () => {
    const renderer: HtmlToPdfRenderer = {
      render: vi.fn(async () => Buffer.from("%PDF-1.7\n")),
      close: vi.fn(async () => undefined),
    };
    const context = createPlugToolsExecuteContext({
      parameters: {
        markdown: "# Title\n\nBody",
        fileName: "from-markdown",
        outputBinaryProperty: "pdf",
        browserOptions: { browserChannel: "auto" },
        pdfOptions: { format: "A4" },
        includePlugToolsMetadata: true,
        metadataProperty: "__plugTools",
      },
    });

    const output = await executePlugToolsDocumentNode(
      context,
      { nodeDisplayName: "Plug Tools", renderer },
      plugToolMarkdownToPdfOperation,
    );

    expect(renderer.render).toHaveBeenCalledOnce();
    expect(renderer.render.mock.calls[0]?.[0]?.html).toContain("<h1>Title</h1>");
    expect(output[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: plugToolMarkdownToPdfOperation,
      fileName: "from-markdown.pdf",
      outputBinaryProperty: "pdf",
    });
    expect(renderer.close).toHaveBeenCalledOnce();
  });

  it("renders plain text to PDF through the injected HTML renderer", async () => {
    const renderer: HtmlToPdfRenderer = {
      render: vi.fn(async () => Buffer.from("%PDF-1.7\n")),
      close: vi.fn(async () => undefined),
    };
    const context = createPlugToolsExecuteContext({
      parameters: {
        text: "Line one\nLine two",
        fileName: "from-text",
        outputBinaryProperty: "pdf",
        browserOptions: { browserChannel: "auto" },
        pdfOptions: {},
        includePlugToolsMetadata: true,
        metadataProperty: "__plugTools",
      },
    });

    const output = await executePlugToolsDocumentNode(
      context,
      { nodeDisplayName: "Plug Tools", renderer },
      plugToolTextToPdfOperation,
    );

    expect(renderer.render).toHaveBeenCalledOnce();
    expect(renderer.render.mock.calls[0]?.[0]?.html).toContain("Line one");
    expect(output[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: plugToolTextToPdfOperation,
      fileName: "from-text.pdf",
    });
  });

  it("rejects oversized PDF inputs before merge", async () => {
    const context = createPlugToolsExecuteContext({
      continueOnFail: true,
      binaryBuffer: Buffer.alloc(16),
      parameters: {
        binaryPropertyName: "data",
        maxInputSizeBytes: 8,
        outputBinaryProperty: "merged",
        pdfAttachments: { values: [] },
      },
    });

    const output = await executePlugToolsDocumentNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      plugToolMergePdfsOperation,
    );

    expect(output[0]?.[0]?.json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "PDF input size must be less than or equal to 8 bytes",
    });
  });
});
