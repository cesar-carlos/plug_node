import { describe, expect, it } from "vitest";

import {
  normalizeBarcodeFileName,
  resolveBarcodeRenderHardLimits,
  resolveBarcodeRenderInput,
} from "../../packages/n8n-nodes-plug-database/generated/shared/tools/barcode";

describe("Plug tools barcode helpers", () => {
  it("normalizes file names for the selected output format", () => {
    expect(normalizeBarcodeFileName("barcode", "svg")).toBe("barcode.svg");
    expect(normalizeBarcodeFileName("barcode.png", "svg")).toBe("barcode.png.svg");
    expect(normalizeBarcodeFileName("", "png")).toBe("barcode.png");
  });

  it("resolves QR error correction and hard caps user-controlled limits", () => {
    expect(
      resolveBarcodeRenderInput({
        text: "https://example.com",
        barcodeType: "qrcode",
        outputFormat: "png",
        renderOptions: {
          qrErrorCorrection: "h",
          maxTextSizeBytes: 100,
          maxOutputSizeBytes: 1000,
        },
        hardLimits: {
          maxTextSizeBytes: 100,
          maxOutputSizeBytes: 1000,
        },
      }),
    ).toMatchObject({
      qrErrorCorrection: "H",
      maxOutputSizeBytes: 1000,
    });

    expect(() =>
      resolveBarcodeRenderInput({
        text: "payload",
        barcodeType: "qrcode",
        outputFormat: "png",
        renderOptions: {
          maxTextSizeBytes: 101,
        },
        hardLimits: {
          maxTextSizeBytes: 100,
          maxOutputSizeBytes: 1000,
        },
      }),
    ).toThrow("Max Text Size Bytes must be less than or equal to 100 bytes");
    expect(() =>
      resolveBarcodeRenderInput({
        text: "payload",
        barcodeType: "qrcode",
        outputFormat: "png",
        renderOptions: {
          qrErrorCorrection: "X",
        },
      }),
    ).toThrow("QR Error Correction must be L, M, Q, or H");
  });

  it("allows deployment-specific hard caps through environment variables", () => {
    expect(
      resolveBarcodeRenderHardLimits({
        PLUG_TOOLS_MAX_BARCODE_TEXT_SIZE_BYTES: "123",
        PLUG_TOOLS_MAX_BARCODE_OUTPUT_SIZE_BYTES: "456",
      }),
    ).toEqual({
      maxTextSizeBytes: 123,
      maxOutputSizeBytes: 456,
    });
  });
});
