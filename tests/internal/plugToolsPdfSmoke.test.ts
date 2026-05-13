import { describe, expect, it } from "vitest";

import {
  createPlaywrightHtmlToPdfRenderer,
  normalizeHtmlDocument,
  resolvePdfBrowserLaunchOptions,
  resolvePdfRenderOptions,
} from "../../packages/n8n-nodes-plug-database/generated/shared/tools/pdf";

describe.skipIf(process.env.PLUG_TEST_REAL_PDF !== "1")(
  "Plug tools real PDF renderer",
  () => {
    it("renders a small PDF with the configured Chromium runtime", async () => {
      const renderer = createPlaywrightHtmlToPdfRenderer();

      try {
        const browser = resolvePdfBrowserLaunchOptions({
          channel: "auto",
          timeoutMs: 30_000,
        });
        const pdf = resolvePdfRenderOptions({});
        const html = normalizeHtmlDocument(
          "<!doctype html><html><body><h1>Plug PDF Smoke Test</h1></body></html>",
          "",
          pdf.maxHtmlSizeBytes,
        );
        const buffer = await renderer.render({ html, browser, pdf });

        expect(buffer.subarray(0, 4).toString("utf8")).toBe("%PDF");
      } finally {
        await renderer.close();
      }
    }, 60_000);
  },
);
