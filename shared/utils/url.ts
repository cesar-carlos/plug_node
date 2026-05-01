import { PlugValidationError } from "../contracts/errors";

export const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

export const buildApiUrl = (baseUrl: string, path: string): string => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
};

export const deriveSocketNamespaceUrl = (baseUrl: string, namespace: string): string => {
  try {
    const url = new URL(baseUrl);
    return `${url.origin}${namespace.startsWith("/") ? namespace : `/${namespace}`}`;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Invalid base URL";
    throw new PlugValidationError("Base URL must be a valid absolute URL", {
      technicalMessage: message,
    });
  }
};
