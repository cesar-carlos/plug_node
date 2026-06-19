import { LoggerProxy } from "n8n-workflow";

import type { JsonObject } from "../contracts/api";

const redactedValue = "[redacted]";

const sensitiveMetadataKeys = new Set([
  "password",
  "token",
  "refreshtoken",
  "clienttoken",
  "payloadsigningkey",
  "accesstoken",
  "authorization",
  "apikey",
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const redactSensitiveMetadata = (metadata: JsonObject): JsonObject => {
  const redacted: JsonObject = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) {
      continue;
    }

    if (sensitiveMetadataKeys.has(key.toLowerCase())) {
      redacted[key] = redactedValue;
      continue;
    }

    if (Array.isArray(value)) {
      redacted[key] = value.map((item) =>
        isRecord(item) ? redactSensitiveMetadata(item as JsonObject) : item,
      ) as JsonObject[keyof JsonObject];
      continue;
    }

    if (isRecord(value)) {
      redacted[key] = redactSensitiveMetadata(value as JsonObject);
      continue;
    }

    redacted[key] = value;
  }

  return redacted;
};

const sanitizeMetadata = (metadata?: JsonObject): JsonObject | undefined => {
  if (!metadata) {
    return undefined;
  }

  const redacted = redactSensitiveMetadata(metadata);
  const entries = Object.entries(redacted).filter(([, value]) => value !== undefined);
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
