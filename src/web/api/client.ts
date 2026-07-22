export interface ApiErrorBody {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
  issues?: Array<{ path: string; message: string }>;
}

export type ApiEnvelope<T> =
  | { data: T }
  | { error: ApiErrorBody; requestId?: string };

export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fieldErrors?: Record<string, string[]>;
  readonly requestId?: string;

  constructor(error: ApiErrorBody, status: number) {
    super(error.message);
    this.name = "ApiError";
    this.code = error.code;
    this.status = status;
    this.fieldErrors = error.fieldErrors;
    this.requestId = error.requestId;
  }
}

export interface RequestOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
}

export function buildApiUrl(
  path: string,
  query?: RequestOptions["query"],
  baseUrl = "/api/v1",
): string {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const isVersionedPath =
    normalizedPath === baseUrl || normalizedPath.startsWith(`${baseUrl}/`);
  const url = new URL(
    isVersionedPath ? normalizedPath : `${baseUrl}${normalizedPath}`,
    "http://bobarr.local",
  );

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  return `${url.pathname}${url.search}`;
}

function isApiEnvelope<T>(value: unknown): value is ApiEnvelope<T> {
  if (!value || typeof value !== "object") return false;
  if (Object.prototype.hasOwnProperty.call(value, "data")) return true;
  if (!Object.prototype.hasOwnProperty.call(value, "error")) return false;
  const error = (value as { error?: unknown }).error;
  return Boolean(
    error && typeof error === "object" && "code" in error && "message" in error,
  );
}

const csrfStorageKey = "bobarr.csrf";

function storedCsrfToken(): string | undefined {
  try {
    return globalThis.sessionStorage?.getItem(csrfStorageKey) ?? undefined;
  } catch {
    return undefined;
  }
}

function captureCsrfToken(value: unknown): void {
  if (!value || typeof value !== "object" || !("csrfToken" in value)) return;
  const token = value.csrfToken;
  if (typeof token !== "string") return;
  try {
    globalThis.sessionStorage?.setItem(csrfStorageKey, token);
  } catch {
    // Browser storage may be unavailable in hardened contexts.
  }
}

function clearCsrfToken(): void {
  try {
    globalThis.sessionStorage?.removeItem(csrfStorageKey);
  } catch {
    // Nothing to clear when browser storage is unavailable.
  }
}

export async function apiRequest<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers(options.headers);
  const hasBody = options.body !== undefined;

  if (
    hasBody &&
    !(options.body instanceof FormData) &&
    !(options.body instanceof Blob) &&
    !headers.has("content-type")
  ) {
    headers.set("content-type", "application/json");
  }
  if (options.body instanceof Blob && !headers.has("content-type")) {
    headers.set("content-type", "application/octet-stream");
  }
  headers.set("accept", "application/json");
  const method = (options.method ?? "GET").toUpperCase();
  const csrfToken = storedCsrfToken();
  if (
    !["GET", "HEAD", "OPTIONS"].includes(method) &&
    csrfToken &&
    !headers.has("x-csrf-token")
  ) {
    headers.set("x-csrf-token", csrfToken);
  }

  let body: BodyInit | undefined;
  if (options.body instanceof FormData) body = options.body;
  else if (options.body instanceof Blob) body = options.body;
  else if (hasBody) body = JSON.stringify(options.body);

  const response = await fetch(buildApiUrl(path, options.query), {
    ...options,
    credentials: "same-origin",
    headers,
    body,
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const contentType = response.headers.get("content-type") ?? "";
  const payload: unknown = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (isApiEnvelope<T>(payload)) {
    if ("error" in payload) {
      const fieldErrors =
        payload.error.fieldErrors ??
        Object.fromEntries(
          (payload.error.issues ?? []).map((issue) => [
            issue.path,
            [issue.message],
          ]),
        );
      throw new ApiError(
        {
          ...payload.error,
          fieldErrors,
          requestId: payload.error.requestId ?? payload.requestId,
        },
        response.status,
      );
    }
    if (!response.ok) {
      throw new ApiError(
        {
          code: "HTTP_ERROR",
          message: `Request failed with status ${response.status}.`,
        },
        response.status,
      );
    }
    captureCsrfToken(payload.data);
    if (path.endsWith("/auth/logout")) clearCsrfToken();
    return payload.data;
  }

  if (!response.ok) {
    const message =
      typeof payload === "string" && payload.trim()
        ? payload
        : `Request failed with status ${response.status}.`;
    throw new ApiError({ code: "HTTP_ERROR", message }, response.status);
  }

  // Accept a bare payload during development, while production endpoints use envelopes.
  captureCsrfToken(payload);
  if (path.endsWith("/auth/logout")) clearCsrfToken();
  return payload as T;
}

type OptionField<TKey extends string, TValue> = [TValue] extends [never]
  ? object
  : undefined extends TValue
    ? { [TProperty in TKey]?: Exclude<TValue, undefined> }
    : { [TProperty in TKey]: TValue };

type ParamsField<TName extends ApiRouteName> =
  keyof ApiRouteParams<TName> extends never
    ? object
    : { params: ApiRouteParams<TName> };

export type ApiCallOptions<TName extends ApiRouteName> = ParamsField<TName> &
  OptionField<"query", ApiRouteQuery<TName>> &
  OptionField<"body", ApiRouteBody<TName>> &
  OptionField<"headers", ApiRouteHeaders<TName>> & {
    signal?: AbortSignal;
  };

type HasRequiredValue<TValue> = [TValue] extends [never]
  ? false
  : undefined extends TValue
    ? false
    : true;

type NeedsOptions<TName extends ApiRouteName> =
  keyof ApiRouteParams<TName> extends never
    ? HasRequiredValue<ApiRouteQuery<TName>> extends true
      ? true
      : HasRequiredValue<ApiRouteBody<TName>> extends true
        ? true
        : HasRequiredValue<ApiRouteHeaders<TName>> extends true
          ? true
          : false
    : true;

type ApiCallArguments<TName extends ApiRouteName> =
  NeedsOptions<TName> extends true
    ? [options: ApiCallOptions<TName>]
    : [options?: ApiCallOptions<TName>];

interface RuntimeCallOptions {
  params?: Record<string, string | number>;
  query?: RequestOptions["query"];
  body?: unknown;
  headers?: HeadersInit;
  signal?: AbortSignal;
}

function requestRoute<TName extends ApiRouteName>(
  name: TName,
  options: RuntimeCallOptions = {},
): Promise<ApiRouteResponse<TName>> {
  const route = apiRoutes[name];
  return apiRequest<ApiRouteResponse<TName>>(
    apiPath(name, options.params as Partial<ApiRouteParams<TName>> | undefined),
    {
      method: route.method,
      query: options.query,
      body: options.body,
      headers: options.headers,
      signal: options.signal,
    },
  );
}

export const api = {
  get<TName extends ApiRouteNamesFor<"GET">>(
    name: TName,
    ...args: ApiCallArguments<TName>
  ) {
    return requestRoute(name, args[0] as RuntimeCallOptions | undefined);
  },
  post<TName extends ApiRouteNamesFor<"POST">>(
    name: TName,
    ...args: ApiCallArguments<TName>
  ) {
    return requestRoute(name, args[0] as RuntimeCallOptions | undefined);
  },
  patch<TName extends ApiRouteNamesFor<"PATCH">>(
    name: TName,
    ...args: ApiCallArguments<TName>
  ) {
    return requestRoute(name, args[0] as RuntimeCallOptions | undefined);
  },
  delete<TName extends ApiRouteNamesFor<"DELETE">>(
    name: TName,
    ...args: ApiCallArguments<TName>
  ) {
    return requestRoute(name, args[0] as RuntimeCallOptions | undefined);
  },
};
import type {
  ApiRouteBody,
  ApiRouteHeaders,
  ApiRouteName,
  ApiRouteNamesFor,
  ApiRouteParams,
  ApiRouteQuery,
  ApiRouteResponse,
} from "../../contracts/api-routes";

import { apiPath, apiRoutes } from "../../contracts/api-routes";
