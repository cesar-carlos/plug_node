import { PlugValidationError } from "../contracts/errors";

export const normalizeBaseUrl = (value: string): string => value.replace(/\/+$/, "");

export const buildApiUrl = (baseUrl: string, path: string): string => {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
};

export const buildApiUrlWithQuery = (
  baseUrl: string,
  path: string,
  query: Readonly<Record<string, string | number | boolean | undefined>>,
): string => {
  const url = new URL(buildApiUrl(baseUrl, path));

  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  return url.toString();
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
