import { Buffer } from "node:buffer";

import sharp, { type Sharp } from "sharp";

import { PlugValidationError } from "../contracts/errors";

export type ImageOutputFormat = "png" | "jpeg" | "webp";

export interface ImageTransformResult {
  readonly buffer: Buffer;
  readonly mimeType: string;
  readonly extension: ImageOutputFormat;
  readonly width?: number;
  readonly height?: number;
}

const allowedFormats = new Set<ImageOutputFormat>(["png", "jpeg", "webp"]);

const toPositiveInteger = (
  value: unknown,
  fallback: number | undefined,
  label: string,
): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  const numberValue = Number(value);
  if (!Number.isInteger(numberValue) || numberValue <= 0) {
    throw new PlugValidationError(`${label} must be a positive integer`);
  }

  return numberValue;
};

const toFormat = (
  value: unknown,
  fallback: ImageOutputFormat = "png",
): ImageOutputFormat => {
  const format = typeof value === "string" && value.trim() ? value.trim() : fallback;
  if (!allowedFormats.has(format as ImageOutputFormat)) {
    throw new PlugValidationError("Image Format must be png, jpeg, or webp");
  }

  return format as ImageOutputFormat;
};

const toQuality = (value: unknown): number | undefined => {
  const quality = toPositiveInteger(value, undefined, "Quality");
  if (quality !== undefined && quality > 100) {
    throw new PlugValidationError("Quality must be between 1 and 100");
  }

  return quality;
};

const mimeForFormat = (format: ImageOutputFormat): string =>
  format === "jpeg" ? "image/jpeg" : `image/${format}`;

const render = async (
  pipeline: Sharp,
  format: ImageOutputFormat,
  quality?: number,
): Promise<ImageTransformResult> => {
  const { data, info } = await pipeline
    .toFormat(format, quality ? { quality } : undefined)
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: data,
    mimeType: mimeForFormat(format),
    extension: format,
    width: info.width,
    height: info.height,
  };
};

export const resizeImage = async (
  buffer: Buffer,
  options: {
    readonly width?: unknown;
    readonly height?: unknown;
    readonly format?: unknown;
    readonly quality?: unknown;
  },
): Promise<ImageTransformResult> => {
  const format = toFormat(options.format);
  return render(
    sharp(buffer).resize({
      width: toPositiveInteger(options.width, undefined, "Width"),
      height: toPositiveInteger(options.height, undefined, "Height"),
      fit: "inside",
      withoutEnlargement: true,
    }),
    format,
    toQuality(options.quality),
  );
};

export const convertImage = async (
  buffer: Buffer,
  options: { readonly format?: unknown; readonly quality?: unknown },
): Promise<ImageTransformResult> =>
  render(sharp(buffer), toFormat(options.format), toQuality(options.quality));

export const compressImage = async (
  buffer: Buffer,
  options: { readonly format?: unknown; readonly quality?: unknown },
): Promise<ImageTransformResult> =>
  render(
    sharp(buffer),
    toFormat(options.format, "jpeg"),
    toQuality(options.quality) ?? 80,
  );

export const createThumbnail = async (
  buffer: Buffer,
  options: {
    readonly size?: unknown;
    readonly format?: unknown;
    readonly quality?: unknown;
  },
): Promise<ImageTransformResult> => {
  const size = toPositiveInteger(options.size, 256, "Size") ?? 256;
  return render(
    sharp(buffer).resize({ width: size, height: size, fit: "cover" }),
    toFormat(options.format),
    toQuality(options.quality),
  );
};

export const addImageWatermark = async (
  buffer: Buffer,
  options: {
    readonly text?: unknown;
    readonly opacity?: unknown;
    readonly format?: unknown;
    readonly quality?: unknown;
  },
): Promise<ImageTransformResult> => {
  const metadata = await sharp(buffer).metadata();
  const width = metadata.width ?? 800;
  const height = metadata.height ?? 600;
  const text =
    typeof options.text === "string" && options.text.trim()
      ? options.text.trim()
      : "Watermark";
  const opacity = Number(options.opacity ?? 0.4);
  if (!Number.isFinite(opacity) || opacity <= 0 || opacity > 1) {
    throw new PlugValidationError("Opacity must be between 0 and 1");
  }

  const svg = Buffer.from(
    `<svg width="${width}" height="${height}"><text x="50%" y="50%" text-anchor="middle" font-family="Arial" font-size="${Math.max(24, Math.round(width / 14))}" fill="rgba(255,255,255,${opacity})" stroke="rgba(0,0,0,${opacity})" stroke-width="2">${text.replace(/&/gu, "&amp;").replace(/</gu, "&lt;")}</text></svg>`,
    "utf8",
  );

  return render(
    sharp(buffer).composite([{ input: svg, gravity: "center" }]),
    toFormat(options.format),
    toQuality(options.quality),
  );
};
