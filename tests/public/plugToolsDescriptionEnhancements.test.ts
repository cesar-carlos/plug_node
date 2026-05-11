import { describe, expect, it } from "vitest";

import { PlugDatabase } from "../../packages/n8n-nodes-plug-database/nodes/PlugDatabase/PlugDatabase.node";
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

  it("groups consolidated tools by category and keeps image fields operation-specific", () => {
    const node = new PlugDatabase();
    const toolCategory = node.description.properties.find(
      (property) => property.name === "toolCategory",
    );
    const resizeOptions = node.description.properties.find(
      (property) =>
        property.name === "imageOptions" &&
        property.displayOptions?.show?.operation?.[0] === "resizeImage",
    );
    const thumbnailOptions = node.description.properties.find(
      (property) =>
        property.name === "imageOptions" &&
        property.displayOptions?.show?.operation?.[0] === "createThumbnail",
    );
    const base64BinaryProperty = node.description.properties.find(
      (property) =>
        property.name === "binaryPropertyName" &&
        property.displayOptions?.show?.operation?.[0] === "base64",
    );

    expect(toolCategory?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "Documents", value: "documents" }),
        expect.objectContaining({ name: "Security", value: "security" }),
      ]),
    );
    expect(resizeOptions?.options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "width" }),
        expect.objectContaining({ name: "height" }),
      ]),
    );
    expect(resizeOptions?.options).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "watermarkText" })]),
    );
    expect(thumbnailOptions?.options).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "size" })]),
    );
    expect(base64BinaryProperty?.displayOptions?.show).toMatchObject({
      operation: ["base64"],
      base64Mode: ["encode"],
      base64EncodeInput: ["binary"],
    });
  });
});
