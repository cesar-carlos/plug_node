import { Buffer } from "node:buffer";

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  plugToolAddImageWatermarkOperation,
  plugToolCompressImageOperation,
  plugToolConvertImageOperation,
  plugToolCreateThumbnailOperation,
  plugToolResizeImageOperation,
} from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsDescription";
import { executePlugToolsImageNode } from "../../packages/n8n-nodes-plug-database/generated/shared/n8n/plugToolsImageExecution";
import { createPlugToolsExecuteContext } from "../helpers/createPlugToolsExecuteContext";

const imageResult = {
  buffer: Buffer.from("image-output"),
  mimeType: "image/png",
  extension: "png" as const,
  width: 64,
  height: 48,
};

vi.mock("../../packages/n8n-nodes-plug-database/generated/shared/tools/image", () => ({
  resizeImage: vi.fn(async () => imageResult),
  convertImage: vi.fn(async () => imageResult),
  compressImage: vi.fn(async () => imageResult),
  addImageWatermark: vi.fn(async () => imageResult),
  createThumbnail: vi.fn(async () => imageResult),
}));

const imageTools = await import(
  "../../packages/n8n-nodes-plug-database/generated/shared/tools/image"
);

describe("executePlugToolsImageNode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const runOperation = async (operation: string, imageOptions: Record<string, unknown>) => {
    const input = Buffer.from("input-image");
    const context = createPlugToolsExecuteContext({
      binaryBuffer: input,
      parameters: {
        binaryPropertyName: "data",
        outputBinaryProperty: "image",
        maxInputSizeBytes: 25_000_000,
        imageOptions,
      },
    });

    const output = await executePlugToolsImageNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      operation as Parameters<typeof executePlugToolsImageNode>[2],
    );

    return { context, output };
  };

  it("resizes images and writes binary output metadata", async () => {
    const { context, output } = await runOperation(plugToolResizeImageOperation, {
      width: 320,
      height: 240,
      maxOutputSizeBytes: 25_000_000,
    });

    expect(imageTools.resizeImage).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({ width: 320, height: 240 }),
    );
    expect(output[0]?.[0]?.json.__plugTools).toMatchObject({
      operation: plugToolResizeImageOperation,
      width: 64,
      height: 48,
      mimeType: "image/png",
      outputBinaryProperty: "image",
    });
    expect(output[0]?.[0]?.binary?.image?.mimeType).toBe("image/png");
    expect(context.preparedBinaries[0]?.fileName).toBe("image.png");
  });

  it("converts images to the requested format", async () => {
    await runOperation(plugToolConvertImageOperation, {
      format: "webp",
      maxOutputSizeBytes: 25_000_000,
    });

    expect(imageTools.convertImage).toHaveBeenCalledOnce();
  });

  it("compresses images with quality options", async () => {
    await runOperation(plugToolCompressImageOperation, {
      quality: 80,
      maxOutputSizeBytes: 25_000_000,
    });

    expect(imageTools.compressImage).toHaveBeenCalledOnce();
  });

  it("adds a watermark using text and opacity options", async () => {
    await runOperation(plugToolAddImageWatermarkOperation, {
      watermarkText: "CONFIDENTIAL",
      watermarkOpacity: 0.5,
      maxOutputSizeBytes: 25_000_000,
    });

    expect(imageTools.addImageWatermark).toHaveBeenCalledWith(
      expect.any(Buffer),
      expect.objectContaining({
        text: "CONFIDENTIAL",
        opacity: 0.5,
      }),
    );
  });

  it("creates thumbnails", async () => {
    await runOperation(plugToolCreateThumbnailOperation, {
      width: 128,
      height: 128,
      maxOutputSizeBytes: 25_000_000,
    });

    expect(imageTools.createThumbnail).toHaveBeenCalledOnce();
  });

  it("rejects outputs larger than maxOutputSizeBytes", async () => {
    vi.mocked(imageTools.resizeImage).mockResolvedValueOnce({
      ...imageResult,
      buffer: Buffer.alloc(32),
    });

    const context = createPlugToolsExecuteContext({
      continueOnFail: true,
      binaryBuffer: Buffer.from("input"),
      parameters: {
        binaryPropertyName: "data",
        outputBinaryProperty: "image",
        maxInputSizeBytes: 25_000_000,
        imageOptions: {
          width: 10,
          maxOutputSizeBytes: 16,
        },
      },
    });

    const output = await executePlugToolsImageNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      plugToolResizeImageOperation,
    );

    expect(output[0]?.[0]?.json.error).toMatchObject({
      message: "Image output size must be less than or equal to 16 bytes",
    });
  });

  it("rejects oversized image inputs", async () => {
    const context = createPlugToolsExecuteContext({
      continueOnFail: true,
      binaryBuffer: Buffer.alloc(20),
      parameters: {
        binaryPropertyName: "data",
        outputBinaryProperty: "image",
        maxInputSizeBytes: 8,
        imageOptions: {
          maxOutputSizeBytes: 25_000_000,
        },
      },
    });

    const output = await executePlugToolsImageNode(
      context,
      { nodeDisplayName: "Plug Tools" },
      plugToolResizeImageOperation,
    );

    expect(output[0]?.[0]?.json.error).toMatchObject({
      code: "PLUG_VALIDATION_ERROR",
      message: "Image input size must be less than or equal to 8 bytes",
    });
  });
});
