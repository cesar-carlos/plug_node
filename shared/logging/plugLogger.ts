import { LoggerProxy } from "n8n-workflow";

import type { JsonObject } from "../contracts/api";

const sanitizeMetadata = (metadata?: JsonObject): JsonObject | undefined => {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([, value]) => value !== undefined);
  if (entries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(entries);
};

const writeLog = (
  level: "debug" | "info" | "warn",
  event: string,
  metadata?: JsonObject,
): void => {
  const payload = sanitizeMetadata(metadata);
  const message = `[plug-node] ${event}`;

  if (level === "warn") {
    LoggerProxy.warn(message, payload);
    return;
  }

  if (level === "info") {
    LoggerProxy.info(message, payload);
    return;
  }

  LoggerProxy.debug(message, payload);
};

export const plugLogger = {
  debug(event: string, metadata?: JsonObject): void {
    writeLog("debug", event, metadata);
  },
  info(event: string, metadata?: JsonObject): void {
    writeLog("info", event, metadata);
  },
  warn(event: string, metadata?: JsonObject): void {
    writeLog("warn", event, metadata);
  },
};
