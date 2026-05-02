import type {
  IExecuteFunctions,
  IHttpRequestOptions,
  INode,
  INodeExecutionData,
} from "n8n-workflow";

import type { PlugCredentials } from "../../../packages/n8n-nodes-plug-database/generated/shared/contracts/api";

export interface LiveExecuteContextOptions {
  readonly credentials: PlugCredentials;
  readonly parameters: Record<string, unknown>;
  readonly inputData?: INodeExecutionData[];
  readonly continueOnFail?: boolean;
}

const defaultNode: INode = {
  id: "plug-database-e2e-node",
  name: "Plug Database E2E",
  type: "plugDatabase",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

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

const toFetchBody = (body: IHttpRequestOptions["body"]): BodyInit | undefined => {
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

export const createLiveExecuteContext = (
  options: LiveExecuteContextOptions,
): IExecuteFunctions => {
  const context = {
    helpers: {
      httpRequest: async (request: IHttpRequestOptions): Promise<unknown> => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), request.timeout ?? 30_000);

        try {
          const response = await fetch(request.url, {
            method: request.method,
            headers: request.headers as Record<string, string> | undefined,
            body: toFetchBody(request.body),
            signal: controller.signal,
          });

          const body = await parseResponseBody(response);

          if (request.returnFullResponse) {
            return {
              statusCode: response.status,
              headers: toResponseHeaders(response.headers),
              body,
            };
          }

          return body;
        } finally {
          clearTimeout(timer);
        }
      },
    },
    continueOnFail: () => options.continueOnFail ?? false,
    getInputData: () => options.inputData ?? [],
    getCredentials: async () => options.credentials,
    getNode: () => defaultNode,
    getNodeParameter: (
      name: string,
      _itemIndex: number,
      fallbackValue?: unknown,
    ): unknown => {
      if (name in options.parameters) {
        return options.parameters[name];
      }

      return fallbackValue;
    },
  };

  return context as IExecuteFunctions;
};
