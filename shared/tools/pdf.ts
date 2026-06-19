import { Buffer } from "node:buffer";
import { existsSync } from "node:fs";

import type { Browser, Page, Route } from "playwright-core";

import { PlugValidationError } from "../contracts/errors";
import {
  toCappedPositiveInteger,
  toNonNegativeNumber,
  toPositiveNumber,
} from "../n8n/plugExecutionParameters";
import { toOptionalString } from "../utils/strings";

export type PdfBrowserChannel = "chrome" | "msedge" | "chromium";
export type PdfBrowserChannelOption = "auto" | PdfBrowserChannel;
export type PdfBrowserSource = "playwright-managed" | "executablePath" | "channel";
export type PdfPaperFormat = "A3" | "A4" | "A5" | "Legal" | "Letter";
export type PdfWaitUntil = "load" | "domcontentloaded" | "networkidle";
export type PdfMedia = "print" | "screen";

export interface PdfBrowserLaunchOptions {
  readonly executablePath?: string;
  readonly channel?: PdfBrowserChannel;
  readonly source: PdfBrowserSource;
  readonly timeoutMs: number;
  readonly enableJavaScript: boolean;
}

export interface PdfRenderOptions {
  readonly format: PdfPaperFormat;
  readonly landscape: boolean;
  readonly printBackground: boolean;
  readonly preferCSSPageSize: boolean;
  readonly scale: number;
  readonly waitUntil: PdfWaitUntil;
  readonly media: PdfMedia;
  readonly renderDelayMs: number;
  readonly maxHtmlSizeBytes: number;
  readonly maxOutputSizeBytes: number;
  readonly margin: {
    readonly top: string;
    readonly right: string;
    readonly bottom: string;
    readonly left: string;
  };
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
}

export interface HtmlToPdfRenderInput {
  readonly html: string;
  readonly browser: PdfBrowserLaunchOptions;
  readonly pdf: PdfRenderOptions;
}

export interface HtmlToPdfRenderer {
  render(input: HtmlToPdfRenderInput): Promise<Buffer>;
  close(): Promise<void>;
}

export interface RawPdfBrowserOptions {
  readonly executablePath?: unknown;
  readonly channel?: unknown;
  readonly timeoutMs?: unknown;
  readonly enableJavaScript?: unknown;
}

export interface RawPdfRenderOptions {
  readonly format?: unknown;
  readonly landscape?: unknown;
  readonly printBackground?: unknown;
  readonly preferCSSPageSize?: unknown;
  readonly scale?: unknown;
  readonly marginTop?: unknown;
  readonly marginRight?: unknown;
  readonly marginBottom?: unknown;
  readonly marginLeft?: unknown;
  readonly headerTemplate?: unknown;
  readonly footerTemplate?: unknown;
  readonly waitUntil?: unknown;
  readonly media?: unknown;
  readonly renderDelayMs?: unknown;
  readonly maxHtmlSizeBytes?: unknown;
  readonly maxOutputSizeBytes?: unknown;
}

export interface PdfRenderHardLimits {
  readonly maxHtmlSizeBytes: number;
  readonly maxOutputSizeBytes: number;
}

const defaultBrowserChannel: PdfBrowserChannelOption = "auto";
const defaultBrowserTimeoutMs = 30_000;
const defaultPdfMargin = "20mm";
const defaultRenderDelayMs = 0;
const defaultMaxHtmlSizeBytes = 1_000_000;
const defaultMaxPdfOutputSizeBytes = 25_000_000;
const defaultHardMaxHtmlSizeBytes = 5_000_000;
const defaultHardMaxPdfOutputSizeBytes = 100_000_000;
const allowedBrowserChannels = new Set<PdfBrowserChannelOption>([
  "auto",
  "chrome",
  "msedge",
  "chromium",
]);
const allowedPdfFormats = new Set<PdfPaperFormat>(["A3", "A4", "A5", "Legal", "Letter"]);
const allowedWaitUntilValues = new Set<PdfWaitUntil>([
  "load",
  "domcontentloaded",
  "networkidle",
]);
const allowedPdfMedia = new Set<PdfMedia>(["print", "screen"]);

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

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

const toScale = (value: unknown): number => {
  const scale = toPositiveNumber(value, 1, "Scale");
  if (scale < 0.1 || scale > 2) {
    throw new PlugValidationError("Scale must be between 0.1 and 2");
  }

  return scale;
};

const normalizeMargin = (value: unknown): string =>
  toOptionalString(value) ?? defaultPdfMargin;

const commonBrowserExecutablePaths =
  process.platform === "linux"
    ? [
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
        "/opt/google/chrome/chrome",
        "/usr/bin/microsoft-edge",
        "/opt/microsoft/msedge/msedge",
      ]
    : process.platform === "darwin"
      ? [
          "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ]
      : [];

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const resolvePdfBrowserExecutablePathEnv = (
  env: NodeJS.ProcessEnv = process.env,
): string | undefined =>
  toOptionalString(env.PLUG_TOOLS_BROWSER_EXECUTABLE_PATH) ??
  toOptionalString(env.PLUG_TOOLS_CHROME_EXECUTABLE_PATH);

export const resolveCommonPdfBrowserExecutablePaths = (
  candidates: readonly string[] = commonBrowserExecutablePaths,
): readonly string[] => candidates.filter((candidate) => existsSync(candidate));

export const toPdfBrowserLaunchError = (
  error: unknown,
  browser: PdfBrowserLaunchOptions,
): PlugValidationError => {
  const originalMessage = getErrorMessage(error);
  if (browser.source === "playwright-managed") {
    return new PlugValidationError(
      [
        "Chromium browser for PDF rendering was not found.",
        "Reinstall this n8n node package with npm install scripts enabled so @playwright/browser-chromium can download Chromium, or set Browser Executable Path / PLUG_TOOLS_BROWSER_EXECUTABLE_PATH to an installed Chrome or Chromium executable.",
        `Original error: ${originalMessage}`,
      ].join(" "),
    );
  }

  if (browser.source === "channel" && browser.channel) {
    return new PlugValidationError(
      [
        `Browser channel "${browser.channel}" was not found for PDF rendering.`,
        "Install that browser, select Auto or Chromium, or set Browser Executable Path / PLUG_TOOLS_BROWSER_EXECUTABLE_PATH to an installed Chrome or Chromium executable.",
        `Original error: ${originalMessage}`,
      ].join(" "),
    );
  }

  return new PlugValidationError(
    [
      "Browser executable for PDF rendering was not found.",
      "Check Browser Executable Path or PLUG_TOOLS_BROWSER_EXECUTABLE_PATH.",
      `Original error: ${originalMessage}`,
    ].join(" "),
  );
};

export const resolvePdfRenderHardLimits = (
  env: NodeJS.ProcessEnv = process.env,
): PdfRenderHardLimits => ({
  maxHtmlSizeBytes: readPositiveIntegerEnv(
    env,
    "PLUG_TOOLS_MAX_HTML_SIZE_BYTES",
    defaultHardMaxHtmlSizeBytes,
  ),
  maxOutputSizeBytes: readPositiveIntegerEnv(
    env,
    "PLUG_TOOLS_MAX_PDF_OUTPUT_SIZE_BYTES",
    defaultHardMaxPdfOutputSizeBytes,
  ),
});

export const normalizeHtml = (value: unknown): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new PlugValidationError("HTML must be a non-empty string");
  }

  return value;
};

const normalizeCss = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new PlugValidationError("CSS must be a string");
  }

  return value;
};

const injectCssIntoHtml = (html: string, css: string | undefined): string => {
  if (!css) {
    return html;
  }

  const styleBlock = `<style>${css}</style>`;
  if (/<\/head\s*>/iu.test(html)) {
    return html.replace(/<\/head\s*>/iu, `${styleBlock}</head>`);
  }

  if (/<html(?:\s[^>]*)?>/iu.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/iu, `<html$1><head>${styleBlock}</head>`);
  }

  return `${styleBlock}${html}`;
};

export const normalizeHtmlDocument = (
  htmlValue: unknown,
  cssValue: unknown,
  maxHtmlSizeBytes: number,
): string => {
  const html = injectCssIntoHtml(normalizeHtml(htmlValue), normalizeCss(cssValue));
  const htmlSizeBytes = Buffer.byteLength(html, "utf8");
  if (htmlSizeBytes > maxHtmlSizeBytes) {
    throw new PlugValidationError(
      `HTML size must be less than or equal to ${maxHtmlSizeBytes} bytes`,
    );
  }

  return html;
};

export const normalizePdfFileName = (value: unknown): string => {
  const fileName = toOptionalString(value) ?? "document.pdf";
  return fileName.toLowerCase().endsWith(".pdf") ? fileName : `${fileName}.pdf`;
};

export const resolvePdfBrowserLaunchOptions = (
  options: RawPdfBrowserOptions,
  envExecutablePath = resolvePdfBrowserExecutablePathEnv(),
): PdfBrowserLaunchOptions => {
  const executablePath =
    toOptionalString(options.executablePath) ?? toOptionalString(envExecutablePath);
  const channelValue = toOptionalString(options.channel) ?? defaultBrowserChannel;
  const timeoutMs = toPositiveNumber(
    options.timeoutMs,
    defaultBrowserTimeoutMs,
    "Timeout (ms)",
  );
  const enableJavaScript = toBoolean(options.enableJavaScript, false);

  if (executablePath) {
    return {
      executablePath,
      source: "executablePath",
      timeoutMs,
      enableJavaScript,
    };
  }

  if (!allowedBrowserChannels.has(channelValue as PdfBrowserChannelOption)) {
    throw new PlugValidationError(
      "Browser Channel must be auto, chromium, chrome, or msedge",
    );
  }

  if (channelValue === "auto") {
    return {
      channel: "chromium",
      source: "playwright-managed",
      timeoutMs,
      enableJavaScript,
    };
  }

  return {
    channel: channelValue as PdfBrowserChannel,
    source: "channel",
    timeoutMs,
    enableJavaScript,
  };
};

export const resolvePdfRenderOptions = (
  options: RawPdfRenderOptions,
  hardLimits: PdfRenderHardLimits = resolvePdfRenderHardLimits(),
): PdfRenderOptions => {
  const formatValue = toOptionalString(options.format) ?? "A4";
  if (!allowedPdfFormats.has(formatValue as PdfPaperFormat)) {
    throw new PlugValidationError("PDF Format must be A3, A4, A5, Legal, or Letter");
  }

  const waitUntilValue = toOptionalString(options.waitUntil) ?? "load";
  if (!allowedWaitUntilValues.has(waitUntilValue as PdfWaitUntil)) {
    throw new PlugValidationError(
      "Wait Until must be load, domcontentloaded, or networkidle",
    );
  }

  const mediaValue = toOptionalString(options.media) ?? "print";
  if (!allowedPdfMedia.has(mediaValue as PdfMedia)) {
    throw new PlugValidationError("PDF Media must be print or screen");
  }

  return {
    format: formatValue as PdfPaperFormat,
    landscape: toBoolean(options.landscape, false),
    printBackground: toBoolean(options.printBackground, true),
    preferCSSPageSize: toBoolean(options.preferCSSPageSize, false),
    scale: toScale(options.scale),
    waitUntil: waitUntilValue as PdfWaitUntil,
    media: mediaValue as PdfMedia,
    renderDelayMs: toNonNegativeNumber(
      options.renderDelayMs,
      defaultRenderDelayMs,
      "Render Delay (ms)",
    ),
    maxHtmlSizeBytes: toCappedPositiveInteger(
      options.maxHtmlSizeBytes,
      defaultMaxHtmlSizeBytes,
      "Max HTML Size Bytes",
      hardLimits.maxHtmlSizeBytes,
    ),
    maxOutputSizeBytes: toCappedPositiveInteger(
      options.maxOutputSizeBytes,
      defaultMaxPdfOutputSizeBytes,
      "Max PDF Output Size Bytes",
      hardLimits.maxOutputSizeBytes,
    ),
    margin: {
      top: normalizeMargin(options.marginTop),
      right: normalizeMargin(options.marginRight),
      bottom: normalizeMargin(options.marginBottom),
      left: normalizeMargin(options.marginLeft),
    },
    ...(toOptionalString(options.headerTemplate)
      ? { headerTemplate: toOptionalString(options.headerTemplate) }
      : {}),
    ...(toOptionalString(options.footerTemplate)
      ? { footerTemplate: toOptionalString(options.footerTemplate) }
      : {}),
  };
};

export const shouldBlockPdfRequestUrl = (requestUrl: string): boolean => {
  try {
    const parsed = new URL(requestUrl);
    return ["http:", "https:", "file:", "ftp:"].includes(parsed.protocol);
  } catch {
    return true;
  }
};

const buildPdfOptions = (
  pdf: PdfRenderOptions,
): NonNullable<Parameters<Page["pdf"]>[0]> => ({
  format: pdf.format,
  landscape: pdf.landscape,
  printBackground: pdf.printBackground,
  preferCSSPageSize: pdf.preferCSSPageSize,
  scale: pdf.scale,
  margin: pdf.margin,
  ...(pdf.headerTemplate || pdf.footerTemplate
    ? {
        displayHeaderFooter: true,
        headerTemplate: pdf.headerTemplate ?? "<span></span>",
        footerTemplate: pdf.footerTemplate ?? "<span></span>",
      }
    : {}),
});

const toLaunchKey = (browser: PdfBrowserLaunchOptions): string =>
  JSON.stringify({
    executablePath: browser.executablePath,
    channel: browser.channel,
    source: browser.source,
  });

const buildLaunchOptions = (
  browser: PdfBrowserLaunchOptions,
  executablePath?: string,
): Parameters<(typeof import("playwright-core"))["chromium"]["launch"]>[0] => ({
  headless: true,
  timeout: browser.timeoutMs,
  ...((executablePath ?? browser.executablePath)
    ? { executablePath: executablePath ?? browser.executablePath }
    : {}),
  ...(executablePath || browser.executablePath || !browser.channel
    ? {}
    : { channel: browser.channel }),
});

export const createPlaywrightHtmlToPdfRenderer = (): HtmlToPdfRenderer => {
  let browser: Browser | undefined;
  let launchKey: string | undefined;

  return {
    render: async (input): Promise<Buffer> => {
      const currentLaunchKey = toLaunchKey(input.browser);
      if (browser && launchKey !== currentLaunchKey) {
        throw new PlugValidationError(
          "Browser executable path and channel must stay the same for every item in one PDF node execution.",
        );
      }

      if (!browser) {
        const { chromium } = await import("playwright-core");
        try {
          browser = await chromium.launch(buildLaunchOptions(input.browser));
        } catch (error: unknown) {
          if (input.browser.source === "playwright-managed") {
            for (const executablePath of resolveCommonPdfBrowserExecutablePaths()) {
              try {
                browser = await chromium.launch(
                  buildLaunchOptions(input.browser, executablePath),
                );
                break;
              } catch {
                continue;
              }
            }
          }

          if (!browser) {
            throw toPdfBrowserLaunchError(error, input.browser);
          }
        }
        launchKey = currentLaunchKey;
      }

      const context = await browser.newContext({
        javaScriptEnabled: input.browser.enableJavaScript,
      });

      try {
        await context.route("**/*", async (route: Route) => {
          if (shouldBlockPdfRequestUrl(route.request().url())) {
            await route.abort("blockedbyclient");
            return;
          }

          await route.continue();
        });

        const page = await context.newPage();
        page.setDefaultTimeout(input.browser.timeoutMs);
        page.setDefaultNavigationTimeout(input.browser.timeoutMs);
        await page.setContent(input.html, {
          waitUntil: input.pdf.waitUntil,
          timeout: input.browser.timeoutMs,
        });
        if (input.pdf.renderDelayMs > 0) {
          await page.waitForTimeout(input.pdf.renderDelayMs);
        }
        await page.emulateMedia({ media: input.pdf.media });
        const pdf = await page.pdf(buildPdfOptions(input.pdf));
        if (pdf.length > input.pdf.maxOutputSizeBytes) {
          throw new PlugValidationError(
            `PDF output size must be less than or equal to ${input.pdf.maxOutputSizeBytes} bytes`,
          );
        }

        return Buffer.from(pdf);
      } finally {
        await context.close();
      }
    },
    close: async (): Promise<void> => {
      await browser?.close();
      browser = undefined;
      launchKey = undefined;
    },
  };
};
