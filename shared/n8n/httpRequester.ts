import type { IHttpRequestOptions } from "n8n-workflow";

import type { PlugHttpRequester, PlugHttpRequestOptions } from "../contracts/api";
import { PlugError, PlugTimeoutError } from "../contracts/errors";
import { isRecord } from "../utils/json";

export interface N8nHttpRequesterContext {
  readonly helpers: {
    httpRequest(requestOptions: IHttpRequestOptions): Promise<unknown>;
  };
}

const isTimeoutLikeError = (error: unknown): boolean => {
  if (!(error instanceof Error)) {
    return false;
  }

  const code =
    "code" in error && typeof (error as { code?: unknown }).code === "string"
      ? (error as { code: string }).code.toUpperCase()
      : undefined;
  if (
    code === "ETIMEDOUT" ||
    code === "ESOCKETTIMEDOUT" ||
    code === "ECONNABORTED" ||
    code === "ECONNRESET"
  ) {
    return true;
  }

  const message = error.message.toLowerCase();
  return (
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("aborted")
  );
};

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

    let response: unknown;
    try {
      response = await context.helpers.httpRequest(requestOptions);
    } catch (error: unknown) {
      if (isTimeoutLikeError(error)) {
        throw new PlugTimeoutError("Plug HTTP request timed out before completion.", {
          timeoutMs: options.timeoutMs,
          eventName: "httpRequest",
          technicalMessage: error instanceof Error ? error.message : undefined,
        });
      }

      if (error instanceof PlugError) {
        throw error;
      }

      throw new PlugError("Plug HTTP request failed before a response was received.", {
        code: "HTTP_REQUEST_FAILED",
        description: "Check network connectivity and the Plug server URL, then retry.",
        retryable: true,
        technicalMessage: error instanceof Error ? error.message : undefined,
      });
    }

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
