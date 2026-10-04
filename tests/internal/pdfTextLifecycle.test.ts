import { Buffer } from "node:buffer";
import { afterEach, describe, expect, it, vi } from "vitest";

const { getDocument } = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ getDocument }));

import { extractPdfText } from "../../packages/n8n-nodes-plug-database/generated/shared/tools/documents";

afterEach(() => vi.clearAllMocks());

describe("PDF text loading lifecycle", () => {
  it("should release the loading task after text extraction", async () => {
    const destroy = vi.fn(async () => undefined);
    getDocument.mockImplementation(() => ({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: [{ str: "Olá" }] }),
        }),
      }),
    }));
    await expect(extractPdfText(Buffer.from("fixture"))).resolves.toEqual({
      pages: [{ pageNumber: 1, text: "Olá" }],
      text: "Olá",
    });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("should release the loading task when the PDF fails to load", async () => {
    const destroy = vi.fn(async () => undefined);
    getDocument.mockImplementation(() => ({
      destroy,
      promise: Promise.reject(new Error("Invalid PDF")),
    }));
    await expect(extractPdfText(Buffer.from("fixture"))).rejects.toThrow("Invalid PDF");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("should release the loading task when reading a page fails", async () => {
    const destroy = vi.fn(async () => undefined);
    getDocument.mockImplementation(() => ({
      destroy,
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => {
          throw new Error("Invalid page");
        },
      }),
    }));
    await expect(extractPdfText(Buffer.from("fixture"))).rejects.toThrow("Invalid page");
    expect(destroy).toHaveBeenCalledOnce();
  });
});
