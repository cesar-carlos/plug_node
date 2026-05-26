import type { IHttpRequestOptions } from "n8n-workflow";

import type { PlugHttpRequester, PlugHttpRequestOptions } from "../contracts/api";
import { PlugError } from "../contracts/errors";
import { isRecord } from "../utils/json";

export interface N8nHttpRequesterContext {
  readonly helpers: {
    httpRequest(requestOptions: IHttpRequestOptions): Promise<unknown>;
  };
}

export const buildN8nHttpRequester = (
  context: N8nHttpRequesterContext,
): PlugHttpRequester => {
  return async <TBody = unknown>(options: PlugHttpRequestOptions) => {
    const requestOptions: IHttpRequestOptions = {
      method: options.method,
      url: options.url,
      headers: options.headers,
      ...(options.body !== undefined
        ? {
            body: options.body as NonNullable<IHttpRequestOptions["body"]>,
          }
        : {}),
      timeout: options.timeoutMs,
      returnFullResponse: true,
      ignoreHttpStatusErrors: true,
      json: true,
    };

    const response = await context.helpers.httpRequest(requestOptions);

    if (!isRecord(response) || typeof response.statusCode !== "number") {
      throw new PlugError(
        "Plug HTTP transport returned a response without a status code.",
        {
          code: "HTTP_RESPONSE_MISSING_STATUS",
          description:
            "The n8n HTTP helper did not include a numeric statusCode. Retry the request and report this if it persists.",
          retryable: true,
        },
      );
    }

    const responseBody = "body" in response ? response.body : response;
    const responseHeaders = isRecord(response.headers)
      ? (response.headers as Record<string, string | string[] | undefined>)
      : {};

    return {
      statusCode: response.statusCode,
      headers: responseHeaders,
      body: responseBody as TBody,
    };
  };
};
