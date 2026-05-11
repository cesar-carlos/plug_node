import { describe, expect, it } from "vitest";

import { PlugDatabaseAdvancedBarcode } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedBarcode/PlugDatabaseAdvancedBarcode.node";
import { PlugDatabaseAdvancedPdf } from "../../packages/n8n-nodes-plug-database-advanced/nodes/PlugDatabaseAdvancedPdf/PlugDatabaseAdvancedPdf.node";

describe("Plug tools node description enhancements", () => {
  it("exposes PDF media and configurable metadata fields", () => {
    const node = new PlugDatabaseAdvancedPdf();
    const pdfOptions = node.description.properties.find(
      (property) => property.name === "pdfOptions",
    );

    expect(pdfOptions?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "media", default: "print" }),
      ]),
    );
    expect(node.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "metadataProperty",
          default: "__plugTools",
        }),
      ]),
    );
  });

  it("exposes QR error correction and configurable base64 fields", () => {
    const node = new PlugDatabaseAdvancedBarcode();
    const renderOptions = node.description.properties.find(
      (property) => property.name === "renderOptions",
    );

    expect(renderOptions?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "qrErrorCorrection", default: "M" }),
      ]),
    );
    expect(node.description.properties).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "fileName", default: "barcode" }),
        expect.objectContaining({
          name: "base64OutputProperty",
          default: "generatedCodeBase64",
        }),
        expect.objectContaining({
          name: "metadataProperty",
          default: "__plugTools",
        }),
      ]),
    );
  });
});
