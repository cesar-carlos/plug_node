import { Buffer } from "node:buffer";

import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  MultiFormatReader,
  RGBLuminanceSource,
} from "@zxing/library";
import sharp from "sharp";

import { PlugValidationError } from "../contracts/errors";
import {
  toCappedPositiveInteger,
  toPositiveNumber,
} from "../n8n/plugExecutionParameters";
import { isRecord } from "../utils/json";
import { toOptionalString } from "../utils/strings";

export type BarcodeOutputFormat = "png" | "svg";
export type BarcodeType =
  | "qrcode"
  | "code128"
  | "ean13"
  | "ean8"
  | "upca"
  | "datamatrix"
  | "pdf417"
  | "azteccode";

export interface BarcodeRenderInput {
  readonly text: string;
  readonly barcodeType: BarcodeType;
  readonly outputFormat: BarcodeOutputFormat;
  readonly scale: number;
  readonly height?: number;
  readonly maxOutputSizeBytes: number;
  readonly includeText: boolean;
  readonly textXAlign: "left" | "center" | "right";
  readonly qrErrorCorrection: "L" | "M" | "Q" | "H";
  readonly foregroundColor?: string;
  readonly backgroundColor?: string;
  readonly advancedOptions?: Record<string, string | number | boolean>;
}

export interface GeneratedBarcode {
  readonly buffer: Buffer;
  readonly mimeType: "image/png" | "image/svg+xml";
  readonly fileExtension: "png" | "svg";
}

export interface ReadBarcodeResult {
  readonly text: string;
  readonly format: string;
  readonly width: number;
  readonly height: number;
  readonly attempt: string;
}

export interface RawBarcodeRenderOptions {
  readonly scale?: unknown;
  readonly height?: unknown;
  readonly maxTextSizeBytes?: unknown;
  readonly maxOutputSizeBytes?: unknown;
  readonly includeText?: unknown;
  readonly textXAlign?: unknown;
  readonly qrErrorCorrection?: unknown;
  readonly foregroundColor?: unknown;
  readonly backgroundColor?: unknown;
}

export interface BarcodeRenderHardLimits {
  readonly maxTextSizeBytes: number;
  readonly maxOutputSizeBytes: number;
}

type BwipJsRenderOptions = Record<string, string | number | boolean | undefined> & {
  readonly bcid: string;
  readonly text: string;
};

interface BwipJsApi {
  toBuffer(options: BwipJsRenderOptions): Promise<Buffer>;
  toSVG(options: BwipJsRenderOptions): string;
}

type BwipJsImport = BwipJsApi & {
  readonly default?: BwipJsApi;
};

const defaultBarcodeType = "qrcode";
const defaultBarcodeScale = 3;
const defaultMaxBarcodeTextSizeBytes = 4_096;
const defaultMaxBarcodeOutputSizeBytes = 10_000_000;
const defaultHardMaxBarcodeTextSizeBytes = 100_000;
const defaultHardMaxBarcodeOutputSizeBytes = 50_000_000;
const allowedOutputFormats = new Set<BarcodeOutputFormat>(["png", "svg"]);
const allowedBarcodeTypes = new Set<BarcodeType>([
  "qrcode",
  "code128",
  "ean13",
  "ean8",
  "upca",
  "datamatrix",
  "pdf417",
  "azteccode",
]);
const allowedTextAlignments = new Set(["left", "center", "right"]);
const allowedQrErrorCorrectionLevels = new Set(["L", "M", "Q", "H"]);
const colorPattern = /^#?[0-9a-fA-F]{6}$/;

const toOptionalPositiveNumber = (value: unknown, label: string): number | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return toPositiveNumber(value, 0, label);
};

const readPositiveIntegerEnv = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number => {
  const value = env[name];
  if (value === undefined || value.trim() === "") {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const normalizeHexColor = (value: unknown, label: string): string | undefined => {
  const color = toOptionalString(value);
  if (!color) {
    return undefined;
  }

  if (!colorPattern.test(color)) {
    throw new PlugValidationError(`${label} must be a 6-digit hex color`);
  }

  return color.replace(/^#/, "").toLowerCase();
};

const normalizeAdvancedOptions = (
  value: unknown,
): Record<string, string | number | boolean> | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    throw new PlugValidationError("Advanced Options JSON must be a JSON object");
  }

  const normalized: Record<string, string | number | boolean> = {};
  for (const [key, optionValue] of Object.entries(value)) {
    if (
      typeof optionValue !== "string" &&
      typeof optionValue !== "number" &&
      typeof optionValue !== "boolean"
    ) {
      throw new PlugValidationError(
        `Advanced Options JSON value for ${key} must be a string, number, or boolean`,
      );
    }

    normalized[key] = optionValue;
  }

  return Object.keys(normalized).length > 0 ? normalized : undefined;
};

export const normalizeBarcodeText = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlugValidationError("Text must be a non-empty string");
  }

  return value;
};

const validateBarcodeTextSize = (text: string, maxTextSizeBytes: number): void => {
  const sizeBytes = Buffer.byteLength(text, "utf8");
  if (sizeBytes > maxTextSizeBytes) {
    throw new PlugValidationError(
      `Text size must be less than or equal to ${maxTextSizeBytes} bytes`,
    );
  }
};

const validateBarcodeTextForType = (barcodeType: BarcodeType, text: string): void => {
  if (barcodeType === "ean13" && !/^\d{12,13}$/.test(text)) {
    throw new PlugValidationError("EAN-13 text must contain 12 or 13 digits");
  }

  if (barcodeType === "ean8" && !/^\d{7,8}$/.test(text)) {
    throw new PlugValidationError("EAN-8 text must contain 7 or 8 digits");
  }

  if (barcodeType === "upca" && !/^\d{11,12}$/.test(text)) {
    throw new PlugValidationError("UPC-A text must contain 11 or 12 digits");
  }
};

export const normalizeBarcodeOutputProperty = (value: unknown): string =>
  toOptionalString(value) ?? "data";

export const resolveBarcodeRenderHardLimits = (
  env: NodeJS.ProcessEnv = process.env,
): BarcodeRenderHardLimits => ({
  maxTextSizeBytes: readPositiveIntegerEnv(
    env,
    "PLUG_TOOLS_MAX_BARCODE_TEXT_SIZE_BYTES",
    defaultHardMaxBarcodeTextSizeBytes,
  ),
  maxOutputSizeBytes: readPositiveIntegerEnv(
    env,
    "PLUG_TOOLS_MAX_BARCODE_OUTPUT_SIZE_BYTES",
    defaultHardMaxBarcodeOutputSizeBytes,
  ),
});

export const normalizeBarcodeFileName = (
  value: unknown,
  outputFormat: BarcodeOutputFormat,
): string => {
  const extension = outputFormat;
  const fileName = toOptionalString(value) ?? `barcode.${extension}`;
  return fileName.toLowerCase().endsWith(`.${extension}`)
    ? fileName
    : `${fileName}.${extension}`;
};

export const resolveBarcodeRenderInput = (input: {
  readonly text: unknown;
  readonly barcodeType: unknown;
  readonly outputFormat: unknown;
  readonly renderOptions?: RawBarcodeRenderOptions;
  readonly advancedOptions?: unknown;
  readonly hardLimits?: BarcodeRenderHardLimits;
}): BarcodeRenderInput => {
  const hardLimits = input.hardLimits ?? resolveBarcodeRenderHardLimits();
  const barcodeType = toOptionalString(input.barcodeType) ?? defaultBarcodeType;
  if (!allowedBarcodeTypes.has(barcodeType as BarcodeType)) {
    throw new PlugValidationError(
      "Barcode Type must be qrcode, code128, ean13, ean8, upca, datamatrix, pdf417, or azteccode",
    );
  }

  const outputFormat = toOptionalString(input.outputFormat) ?? "png";
  if (!allowedOutputFormats.has(outputFormat as BarcodeOutputFormat)) {
    throw new PlugValidationError("Output Format must be png or svg");
  }

  const textXAlign = toOptionalString(input.renderOptions?.textXAlign) ?? "center";
  if (!allowedTextAlignments.has(textXAlign)) {
    throw new PlugValidationError("Text X Align must be left, center, or right");
  }

  const qrErrorCorrection = (
    toOptionalString(input.renderOptions?.qrErrorCorrection) ?? "M"
  ).toUpperCase();
  if (!allowedQrErrorCorrectionLevels.has(qrErrorCorrection)) {
    throw new PlugValidationError("QR Error Correction must be L, M, Q, or H");
  }

  const text = normalizeBarcodeText(input.text);
  const maxTextSizeBytes = toCappedPositiveInteger(
    input.renderOptions?.maxTextSizeBytes,
    defaultMaxBarcodeTextSizeBytes,
    "Max Text Size Bytes",
    hardLimits.maxTextSizeBytes,
  );
  const height = toOptionalPositiveNumber(input.renderOptions?.height, "Height");
  const foregroundColor = normalizeHexColor(
    input.renderOptions?.foregroundColor,
    "Foreground Color",
  );
  const backgroundColor = normalizeHexColor(
    input.renderOptions?.backgroundColor,
    "Background Color",
  );
  const advancedOptions = normalizeAdvancedOptions(input.advancedOptions);

  validateBarcodeTextSize(text, maxTextSizeBytes);
  validateBarcodeTextForType(barcodeType as BarcodeType, text);

  return {
    text,
    barcodeType: barcodeType as BarcodeType,
    outputFormat: outputFormat as BarcodeOutputFormat,
    scale: toPositiveNumber(input.renderOptions?.scale, defaultBarcodeScale, "Scale"),
    maxOutputSizeBytes: toCappedPositiveInteger(
      input.renderOptions?.maxOutputSizeBytes,
      defaultMaxBarcodeOutputSizeBytes,
      "Max Output Size Bytes",
      hardLimits.maxOutputSizeBytes,
    ),
    ...(height ? { height } : {}),
    includeText: toBoolean(input.renderOptions?.includeText, false),
    textXAlign: textXAlign as BarcodeRenderInput["textXAlign"],
    qrErrorCorrection: qrErrorCorrection as BarcodeRenderInput["qrErrorCorrection"],
    ...(foregroundColor ? { foregroundColor } : {}),
    ...(backgroundColor ? { backgroundColor } : {}),
    ...(advancedOptions ? { advancedOptions } : {}),
  };
};

const buildBwipOptions = (input: BarcodeRenderInput): BwipJsRenderOptions => ({
  ...(input.advancedOptions ?? {}),
  bcid: input.barcodeType,
  text: input.text,
  scale: input.scale,
  ...(input.height !== undefined ? { height: input.height } : {}),
  ...(input.includeText ? { includetext: true, textxalign: input.textXAlign } : {}),
  ...(input.barcodeType === "qrcode" ? { eclevel: input.qrErrorCorrection } : {}),
  ...(input.foregroundColor ? { barcolor: input.foregroundColor } : {}),
  ...(input.backgroundColor ? { backgroundcolor: input.backgroundColor } : {}),
});

const loadBwipJs = async (): Promise<BwipJsApi> => {
  const imported = (await import("@bwip-js/node")) as unknown as BwipJsImport;
  return imported.default ?? imported;
};

export const generateBarcode = async (
  input: BarcodeRenderInput,
): Promise<GeneratedBarcode> => {
  const bwipJs = await loadBwipJs();
  const options = buildBwipOptions(input);

  try {
    if (input.outputFormat === "svg") {
      const buffer = Buffer.from(bwipJs.toSVG(options), "utf8");
      if (buffer.length > input.maxOutputSizeBytes) {
        throw new PlugValidationError(
          `Barcode output size must be less than or equal to ${input.maxOutputSizeBytes} bytes`,
        );
      }

      return {
        buffer,
        mimeType: "image/svg+xml",
        fileExtension: "svg",
      };
    }

    const buffer = await bwipJs.toBuffer(options);
    if (buffer.length > input.maxOutputSizeBytes) {
      throw new PlugValidationError(
        `Barcode output size must be less than or equal to ${input.maxOutputSizeBytes} bytes`,
      );
    }

    return {
      buffer,
      mimeType: "image/png",
      fileExtension: "png",
    };
  } catch (error: unknown) {
    if (error instanceof PlugValidationError) {
      throw error;
    }

    throw new PlugValidationError("Failed to generate barcode or QR code", {
      technicalMessage: error instanceof Error ? error.message : String(error),
    });
  }
};

const decodeBarcodeBitmap = (
  data: Buffer,
  width: number,
  height: number,
): { readonly text: string; readonly format: string } => {
  const luminance = new RGBLuminanceSource(Uint8ClampedArray.from(data), width, height);
  const bitmap = new BinaryBitmap(new HybridBinarizer(luminance));
  const reader = new MultiFormatReader();
  reader.setHints(new Map([[DecodeHintType.TRY_HARDER, true]]));
  const result = reader.decode(bitmap);

  return {
    text: result.getText(),
    format: result.getBarcodeFormat().toString(),
  };
};

const readBarcodeAttempt = async (
  buffer: Buffer,
  rotation: number,
  threshold: boolean,
): Promise<ReadBarcodeResult> => {
  let pipeline = sharp(buffer).rotate(rotation).greyscale();
  if (threshold) {
    pipeline = pipeline.threshold(128);
  }

  const { data, info } = await pipeline.raw().toBuffer({ resolveWithObject: true });
  const decoded = decodeBarcodeBitmap(data, info.width, info.height);

  return {
    ...decoded,
    width: info.width,
    height: info.height,
    attempt: `${rotation}deg${threshold ? "-threshold" : ""}`,
  };
};

export const readBarcode = async (buffer: Buffer): Promise<ReadBarcodeResult> => {
  const attempts = [
    { rotation: 0, threshold: false },
    { rotation: 0, threshold: true },
    { rotation: 90, threshold: false },
    { rotation: 180, threshold: false },
    { rotation: 270, threshold: false },
  ];
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      return await readBarcodeAttempt(buffer, attempt.rotation, attempt.threshold);
    } catch (error: unknown) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  try {
    const metadata = await sharp(buffer).metadata();
    throw new PlugValidationError("Failed to read barcode or QR code", {
      technicalMessage: errors.join("; "),
      details: {
        width: metadata.width,
        height: metadata.height,
        attempts: attempts.length,
      },
    });
  } catch (error: unknown) {
    if (error instanceof PlugValidationError) {
      throw error;
    }

    throw new PlugValidationError("Failed to read barcode or QR code", {
      technicalMessage: error instanceof Error ? error.message : String(error),
    });
  }
};
