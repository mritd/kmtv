// API client wiring fetch + bearer token + APIError mapping.
// 装配 fetch、bearer token 与 APIError 映射的 API client.

import { APIError } from "./apiError";

const API_PREFIX = "/api/v1";
const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Configuration accepted by `createAPIClient`.
 * `createAPIClient` 接受的配置.
 */
export interface APIClientOptions {
  baseURL: string;
  getToken: () => string | null;
  onUnauthorized: () => void;
  fetcher?: typeof fetch;
}

/**
 * Per-call overrides.
 * 单次调用的覆盖参数.
 */
export interface RequestOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Minimal API client surface used by feature modules.
 * 功能模块使用的最小 API client 边界.
 */
export interface APIClient {
  baseURL: string;
  get: <T>(path: string, opts?: RequestOptions) => Promise<T>;
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => Promise<T>;
  put: <T>(path: string, body: unknown, opts?: RequestOptions) => Promise<T>;
  del: (path: string, opts?: RequestOptions) => Promise<void>;
}

function stripTrailingSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

function buildHeaders(token: string | null, hasBody: boolean): Headers {
  const h = new Headers();
  if (hasBody) h.set("Content-Type", "application/json");
  if (token) h.set("Authorization", `Bearer ${token}`);
  return h;
}

async function performRequest<T>(
  fetcher: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
  onUnauthorized: () => void,
): Promise<T> {
  const controller = new AbortController();
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetcher(new Request(url, { ...init, signal: controller.signal }));
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") {
      throw { kind: "timeout" } as APIError;
    }
    throw { kind: "network" } as APIError;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    const err = await APIError.fromResponse(res);
    if (err.kind === "unauthorized") onUnauthorized();
    throw err;
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/**
 * Build an APIClient bound to a base URL and token provider.
 * 构造一个与 baseURL 及 token provider 绑定的 APIClient.
 */
export function createAPIClient(options: APIClientOptions): APIClient {
  const baseURL = stripTrailingSlash(options.baseURL);
  const fetcher = options.fetcher ?? fetch;

  function buildURL(path: string): string {
    return `${baseURL}${API_PREFIX}${path}`;
  }

  return {
    baseURL,
    get: <T>(path: string, opts?: RequestOptions) =>
      performRequest<T>(
        fetcher,
        buildURL(path),
        { method: "GET", headers: buildHeaders(options.getToken(), false) },
        opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        opts?.signal,
        options.onUnauthorized,
      ),
    post: <T>(path: string, body?: unknown, opts?: RequestOptions) =>
      performRequest<T>(
        fetcher,
        buildURL(path),
        {
          method: "POST",
          headers: buildHeaders(options.getToken(), body !== undefined),
          body: body === undefined ? undefined : JSON.stringify(body),
        },
        opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        opts?.signal,
        options.onUnauthorized,
      ),
    put: <T>(path: string, body: unknown, opts?: RequestOptions) =>
      performRequest<T>(
        fetcher,
        buildURL(path),
        {
          method: "PUT",
          headers: buildHeaders(options.getToken(), true),
          body: JSON.stringify(body),
        },
        opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        opts?.signal,
        options.onUnauthorized,
      ),
    del: (path: string, opts?: RequestOptions) =>
      performRequest<void>(
        fetcher,
        buildURL(path),
        { method: "DELETE", headers: buildHeaders(options.getToken(), false) },
        opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        opts?.signal,
        options.onUnauthorized,
      ),
  };
}
