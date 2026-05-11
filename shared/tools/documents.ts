import { Buffer } from "node:buffer";

import { marked } from "marked";
import { PDFDocument } from "pdf-lib";

import { PlugValidationError } from "../contracts/errors";

const escapeHtml = (value: string): string =>
  value
    .replace(/&/gu, "&amp;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;")
    .replace(/"/gu, "&quot;")
    .replace(/'/gu, "&#39;");

export const markdownToHtmlDocument = async (markdown: unknown): Promise<string> => {
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new PlugValidationError("Markdown must be a non-empty string");
  }

  const body = await marked.parse(markdown, { async: true });
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>${body}</body></html>`;
};

export const textToHtmlDocument = (text: unknown): string => {
  if (typeof text !== "string" || text.trim() === "") {
    throw new PlugValidationError("Text must be a non-empty string");
  }

  return `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:Arial,sans-serif;white-space:pre-wrap;line-height:1.45}</style></head><body><pre>${escapeHtml(text)}</pre></body></html>`;
};

export const mergePdfBuffers = async (buffers: readonly Buffer[]): Promise<Buffer> => {
  if (buffers.length === 0) {
    throw new PlugValidationError("At least one PDF is required");
  }

  const output = await PDFDocument.create();
  for (const buffer of buffers) {
    const source = await PDFDocument.load(buffer);
    const pages = await output.copyPages(source, source.getPageIndices());
    for (const page of pages) {
      output.addPage(page);
    }
  }

  return Buffer.from(await output.save());
};

export const splitPdfBuffer = async (
  buffer: Buffer,
  pageRange?: string,
): Promise<Array<{ pageNumber: number; buffer: Buffer }>> => {
  const source = await PDFDocument.load(buffer);
  const selectedPages = parsePageRange(pageRange, source.getPageCount());
  const output: Array<{ pageNumber: number; buffer: Buffer }> = [];

  for (const pageIndex of selectedPages) {
    const document = await PDFDocument.create();
    const [page] = await document.copyPages(source, [pageIndex]);
    document.addPage(page);
    output.push({
      pageNumber: pageIndex + 1,
      buffer: Buffer.from(await document.save()),
    });
  }

  return output;
};

export const parsePageRange = (value: unknown, pageCount: number): number[] => {
  if (value === undefined || value === null || value === "") {
    return Array.from({ length: pageCount }, (_, index) => index);
  }

  if (typeof value !== "string") {
    throw new PlugValidationError("Page Range must be a string");
  }

  const indexes = new Set<number>();
  for (const part of value.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") {
      continue;
    }

    const [startRaw, endRaw] = trimmed.split("-");
    const start = Number(startRaw);
    const end = endRaw === undefined || endRaw === "" ? start : Number(endRaw);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start) {
      throw new PlugValidationError(
        "Page Range must contain page numbers or ranges like 1,3-5",
      );
    }

    for (let page = start; page <= end; page += 1) {
      if (page > pageCount) {
        throw new PlugValidationError(`Page ${page} exceeds PDF page count ${pageCount}`);
      }
      indexes.add(page - 1);
    }
  }

  return [...indexes].sort((left, right) => left - right);
};

export const extractPdfText = async (
  buffer: Buffer,
): Promise<{ pages: Array<{ pageNumber: number; text: string }>; text: string }> => {
  const pdfjs =
    (await import("pdfjs-dist/legacy/build/pdf.mjs")) as typeof import("pdfjs-dist");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
  } as Parameters<typeof pdfjs.getDocument>[0]);
  const document = await loadingTask.promise;
  const pages: Array<{ pageNumber: number; text: string }> = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ("str" in item && typeof item.str === "string" ? item.str : ""))
      .join(" ")
      .trim();
    pages.push({ pageNumber, text });
  }

  await document.destroy();

  return {
    pages,
    text: pages.map((page) => page.text).join("\n\n"),
  };
};
