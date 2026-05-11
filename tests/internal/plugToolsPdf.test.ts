import { describe, expect, it } from "vitest";

import {
  resolvePdfBrowserLaunchOptions,
  normalizeHtmlDocument,
  resolvePdfRenderOptions,
  shouldBlockPdfRequestUrl,
} from "../../packages/n8n-nodes-plug-database-advanced/generated/shared/tools/pdf";

describe("Plug tools PDF renderer helpers", () => {
  it("resolves browser executable path before environment and channel", () => {
    expect(
      resolvePdfBrowserLaunchOptions(
        {
          executablePath: "C:\\Chrome\\chrome.exe",
          channel: "msedge",
          timeoutMs: 1200,
          enableJavaScript: true,
        },
        "D:\\Env\\chrome.exe",
      ),
    ).toEqual({
      executablePath: "C:\\Chrome\\chrome.exe",
      timeoutMs: 1200,
      enableJavaScript: true,
    });
  });

  it("resolves environment browser path before channel", () => {
    expect(
      resolvePdfBrowserLaunchOptions(
        {
          channel: "msedge",
          timeoutMs: 1500,
        },
        "D:\\Env\\chrome.exe",
      ),
    ).toEqual({
      executablePath: "D:\\Env\\chrome.exe",
      timeoutMs: 1500,
      enableJavaScript: false,
    });
  });

  it("falls back to the installed Chrome channel", () => {
    expect(resolvePdfBrowserLaunchOptions({}, undefined)).toEqual({
      channel: "chrome",
      timeoutMs: 30000,
      enableJavaScript: false,
    });
  });

  it("blocks network and local file requests while allowing inline document URLs", () => {
    expect(shouldBlockPdfRequestUrl("https://example.com/style.css")).toBe(true);
    expect(shouldBlockPdfRequestUrl("http://example.com/image.png")).toBe(true);
    expect(shouldBlockPdfRequestUrl("file:///etc/passwd")).toBe(true);
    expect(shouldBlockPdfRequestUrl("ftp://example.com/file")).toBe(true);
    expect(shouldBlockPdfRequestUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(shouldBlockPdfRequestUrl("about:blank")).toBe(false);
    expect(shouldBlockPdfRequestUrl("blob:null/abc")).toBe(false);
    expect(shouldBlockPdfRequestUrl("not a url")).toBe(true);
  });

  it("validates PDF render bounds", () => {
    expect(
      resolvePdfRenderOptions({
        format: "Letter",
        scale: 1.5,
        marginTop: "1in",
        waitUntil: "networkidle",
        renderDelayMs: 50,
      }),
    ).toMatchObject({
      format: "Letter",
      scale: 1.5,
      waitUntil: "networkidle",
      renderDelayMs: 50,
      margin: {
        top: "1in",
        right: "20mm",
      },
    });

    expect(() => resolvePdfRenderOptions({ scale: 3 })).toThrow(
      "Scale must be between 0.1 and 2",
    );
    expect(() => resolvePdfRenderOptions({ format: "Tabloid" })).toThrow(
      "PDF Format must be A3, A4, A5, Legal, or Letter",
    );
    expect(() => resolvePdfRenderOptions({ waitUntil: "commit" })).toThrow(
      "Wait Until must be load, domcontentloaded, or networkidle",
    );
  });

  it("injects CSS and enforces the configured HTML size limit", () => {
    expect(
      normalizeHtmlDocument(
        "<!doctype html><html><head></head><body>Report</body></html>",
        "body { margin: 0; }",
        1000,
      ),
    ).toContain("<style>body { margin: 0; }</style></head>");

    expect(() =>
      normalizeHtmlDocument("<html><body>too large</body></html>", "", 4),
    ).toThrow("HTML size must be less than or equal to 4 bytes");
  });
});
