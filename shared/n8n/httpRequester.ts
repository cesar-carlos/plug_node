import type { IHttpRequestOptions } from "n8n-workflow";

import type { PlugHttpRequester, PlugHttpRequestOptions } from "../contracts/api";
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
    const responseBody =
      isRecord(response) && "body" in response ? response.body : response;
    const responseHeaders =
      isRecord(response) && isRecord(response.headers)
        ? (response.headers as Record<string, string | string[] | undefined>)
        : {};
    const statusCode =
      isRecord(response) && typeof response.statusCode === "number"
        ? response.statusCode
        : 200;

    return {
      statusCode,
      headers: responseHeaders,
      body: responseBody as TBody,
    };
  };
};
