import type {
  IAllExecuteFunctions,
  IDataObject,
  IHttpRequestOptions,
} from "n8n-workflow";
import { NodeApiError } from "n8n-workflow";

const credentialName = "pluraAiAutomationsApi";
const integrationsBaseUrl = "https://integrations.plura.ai/api";
const redactedValue = "[redacted]";
const sensitiveFieldNames = new Set([
  "apikey",
  "authorization",
  "email",
  "password",
  "user",
]);

export interface PluraCredentials {
  readonly email?: string;
  readonly password?: string;
  readonly apiKey?: string;
}

interface PluraRequestOptions {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly url: string;
  readonly qs?: IDataObject;
  readonly body?: IHttpRequestOptions["body"];
  readonly headers?: IDataObject;
}

export interface PluraOptionsResponse {
  readonly items?: ReadonlyArray<{
    readonly label: string;
    readonly value: string;
  }>;
}

export const getIntegrationsBaseUrl = (): string => integrationsBaseUrl;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const collectSensitiveValues = (
  value: unknown,
  sensitiveValues: string[] = [],
): string[] => {
  if (Array.isArray(value)) {
    for (const item of value) {
      collectSensitiveValues(item, sensitiveValues);
    }

    return sensitiveValues;
  }

  if (!isRecord(value)) {
    return sensitiveValues;
  }

  for (const [key, item] of Object.entries(value)) {
    if (
      sensitiveFieldNames.has(key.toLowerCase()) &&
      typeof item === "string" &&
      item.trim() !== ""
    ) {
      sensitiveValues.push(item);
      if (key.toLowerCase() === "authorization") {
        const bearerToken = item.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        if (bearerToken) {
          sensitiveValues.push(bearerToken);
        }
      }
    }

    collectSensitiveValues(item, sensitiveValues);
  }

  return sensitiveValues;
};

export const redactPluraSensitiveValues = (
  value: string,
  requestOptions: Pick<PluraRequestOptions, "body" | "headers">,
): string => {
  const sensitiveValues = [
    ...collectSensitiveValues(requestOptions.body),
    ...collectSensitiveValues(requestOptions.headers),
  ];

  return [...new Set(sensitiveValues)].reduce(
    (current, sensitiveValue) => current.split(sensitiveValue).join(redactedValue),
    value,
  );
};

export const getPluraCredentials = async (
  context: IAllExecuteFunctions,
): Promise<PluraCredentials> => {
  const credentials = (await context.getCredentials(credentialName)) as Record<
    string,
    unknown
  >;

  return {
    email: String(credentials.email ?? "").trim() || undefined,
    password: String(credentials.password ?? "").trim() || undefined,
    apiKey: String(credentials.apiKey ?? "").trim() || undefined,
  };
};

export const buildPluraHeaders = (
  credentials: PluraCredentials,
  headers?: IDataObject,
): IDataObject => ({
  ...(headers ?? {}),
  ...(credentials.apiKey ? { Authorization: `Bearer ${credentials.apiKey}` } : {}),
});

export const requestPluraJson = async <T>(
  context: IAllExecuteFunctions,
  options: PluraRequestOptions,
): Promise<T> => {
  try {
    const response = await context.helpers.httpRequest({
      method: options.method,
      url: options.url,
      qs: options.qs,
      body: options.body,
      headers: options.headers,
      json: true,
    });

    return response as T;
  } catch (error: unknown) {
    const rawErrorMessage = error instanceof Error ? error.message : String(error);
    const errorMessage = redactPluraSensitiveValues(rawErrorMessage, options);
    const httpCode =
      error && typeof error === "object" && "httpCode" in error
        ? (error as { readonly httpCode?: number }).httpCode
        : undefined;

    throw new NodeApiError(context.getNode(), {
      message: errorMessage,
      ...(httpCode !== undefined ? { httpCode } : {}),
    });
  }
};
