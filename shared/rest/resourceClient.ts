import { buildAuthorizedHeaders, createHttpError } from "../auth/session";
import type {
  JsonObject,
  PlugAnyLoginResponse,
  PlugEmailPasswordCredentials,
  PlugHttpRequester,
  PlugSession,
} from "../contracts/api";
import { DEFAULT_REQUEST_TIMEOUT_MS } from "../contracts/api";
import { buildApiUrl, buildApiUrlWithQuery } from "../utils/url";

export interface PlugAuthorizedRequestOptions {
  readonly method: "GET" | "POST" | "PUT" | "DELETE";
  readonly path: string;
  readonly query?: Readonly<Record<string, string | number | boolean | undefined>>;
  readonly body?: unknown;
  readonly timeoutMs?: number;
  readonly acceptedStatusCodes?: readonly number[];
}

export interface PlugPaginatedEnvelope<TItem extends JsonObject> extends JsonObject {
  readonly items: TItem[];
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
}

export interface CollectAllPagesOptions<
  TQuery extends {
    readonly page?: number;
    readonly pageSize?: number;
  },
  TItem extends JsonObject,
  TResponse,
> {
  readonly initialQuery: TQuery;
  readonly fetchPage: (query: TQuery) => Promise<TResponse>;
  readonly toEnvelope: (response: TResponse) => PlugPaginatedEnvelope<TItem>;
  readonly buildAggregatedResponse: (
    items: TItem[],
    firstResponse: TResponse,
    lastEnvelope: PlugPaginatedEnvelope<TItem>,
  ) => TResponse;
}

export const requestAuthorizedJson = async <
  TBody = unknown,
  TCredentials extends PlugEmailPasswordCredentials = PlugEmailPasswordCredentials,
  TLoginResponse extends PlugAnyLoginResponse = PlugAnyLoginResponse,
>(
  requester: PlugHttpRequester,
  session: PlugSession<TCredentials, TLoginResponse>,
  options: PlugAuthorizedRequestOptions,
): Promise<TBody> => {
  const url = options.query
    ? buildApiUrlWithQuery(session.credentials.baseUrl, options.path, options.query)
    : buildApiUrl(session.credentials.baseUrl, options.path);

  const response = await requester<TBody>({
    method: options.method,
    url,
    headers: buildAuthorizedHeaders(session, {
      ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
    }),
    ...(options.body !== undefined ? { body: options.body } : {}),
    timeoutMs: options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
  });

  const acceptedStatusCodes = options.acceptedStatusCodes ?? [200];
  if (!acceptedStatusCodes.includes(response.statusCode)) {
    throw createHttpError(response.statusCode, response.body, response.headers);
  }

  return response.body;
};

export const collectAllPages = async <
  TQuery extends {
    readonly page?: number;
    readonly pageSize?: number;
  },
  TItem extends JsonObject,
  TResponse,
>(
  options: CollectAllPagesOptions<TQuery, TItem, TResponse>,
): Promise<TResponse> => {
  const firstResponse = await options.fetchPage(options.initialQuery);
  const firstEnvelope = options.toEnvelope(firstResponse);
  const allItems = [...firstEnvelope.items];

  let currentPage = firstEnvelope.page;
  let lastEnvelope = firstEnvelope;

  while (allItems.length < firstEnvelope.total && lastEnvelope.items.length > 0) {
    currentPage += 1;
    const nextQuery = {
      ...options.initialQuery,
      page: currentPage,
      pageSize: firstEnvelope.pageSize,
    };

    const nextResponse = await options.fetchPage(nextQuery);
    lastEnvelope = options.toEnvelope(nextResponse);
    allItems.push(...lastEnvelope.items);

    if (lastEnvelope.items.length < lastEnvelope.pageSize) {
      break;
    }
  }

  return options.buildAggregatedResponse(allItems, firstResponse, lastEnvelope);
};
