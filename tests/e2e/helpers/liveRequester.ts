import type {
  PlugCredentials,
  PlugHttpRequester,
} from "../../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";

const toResponseHeaders = (headers: Headers): Record<string, string> => {
  const normalized: Record<string, string> = {};
  for (const [key, value] of headers.entries()) {
    normalized[key] = value;
  }
  return normalized;
};

const parseResponseBody = async (response: Response): Promise<unknown> => {
  const text = await response.text();
  if (text.trim() === "") {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(text) as unknown;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
};

const toFetchBody = (body: unknown): BodyInit | undefined => {
  if (body === undefined) {
    return undefined;
  }

  if (
    typeof body === "string" ||
    body instanceof URLSearchParams ||
    body instanceof FormData ||
    body instanceof Blob
  ) {
    return body;
  }

  return JSON.stringify(body);
};

export const createLiveRequester = (_credentials: PlugCredentials): PlugHttpRequester => {
  return async (request) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeoutMs ?? 30_000);

    try {
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: toFetchBody(request.body),
        signal: controller.signal,
      });

      return {
        statusCode: response.status,
        headers: toResponseHeaders(response.headers),
        body: await parseResponseBody(response),
      };
    } finally {
      clearTimeout(timer);
    }
  };
};
