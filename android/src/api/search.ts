// Search API factory: sync /search GET + SSE /search/stream via react-native-sse.
// 搜索 API 工厂: 同步 /search GET + 经 react-native-sse 的 SSE /search/stream.

import EventSource from "react-native-sse";

import type { APIClient } from "./client";
import type { SearchProgress, SearchResponse } from "./types";

/**
 * Surface offered by createSearchAPI.
 * createSearchAPI 暴露的接口.
 */
export interface SearchAPI {
  /**
   * Sync aggregated search — used as the iOS-style fallback when SSE fails or for one-shot queries.
   * 同步聚合搜索, 用作 SSE 失败后的回退或一次性查询.
   */
  search: (query: string, page?: number) => Promise<SearchResponse>;
  /**
   * SSE-driven streaming search. Resolves with the final result frame; rejects on transport or
   * server error or when the caller's AbortController is triggered. progress events flow through
   * the onProgress callback during the stream.
   * SSE 流式搜索. 末帧结果作为返回值; 传输/服务端错误或调用方 AbortController 触发时拒绝.
   * 流期间进度事件通过 onProgress 回调.
   */
  searchStream: (
    query: string,
    onProgress: (progress: SearchProgress) => void,
    options?: { signal?: AbortSignal },
  ) => Promise<SearchResponse>;
}

function buildSearchURL(query: string, page?: number): string {
  const params = new URLSearchParams({ q: query });
  if (page !== undefined) params.set("page", String(page));
  return `/search?${params.toString()}`;
}

/**
 * Build a SearchAPI bound to a client (for sync /search) and a token reader (for SSE Authorization).
 * 基于 client (用于同步 /search) 与 token 读取器 (用于 SSE 鉴权) 构建 SearchAPI.
 */
export function createSearchAPI(
  client: APIClient,
  getToken: () => string | null,
): SearchAPI {
  return {
    search: (query, page) => {
      const trimmed = query.trim();
      return client.get<SearchResponse>(buildSearchURL(trimmed, page));
    },

    searchStream: (query, onProgress, options) =>
      new Promise<SearchResponse>((resolve, reject) => {
        const trimmed = query.trim();
        const headers: Record<string, string> = {};
        const token = getToken();
        if (token) headers.Authorization = `Bearer ${token}`;
        const url = `${client.baseURL}/api/v1/search/stream?q=${encodeURIComponent(trimmed)}`;
        // Type the EventSource loosely: the library's .d.ts strictly types the built-in
        // 'error' channel without `data`, but at runtime server-emitted `event: error` frames
        // DO carry a JSON `data` field. Cast to a permissive shape so we can read both forms.
        // EventSource 的 .d.ts 严格类型化内置 error 通道并去掉了 data, 但服务端 event: error
        // 帧运行时确实带 JSON data, 用宽松类型读取两种形态.
        const source = new EventSource(url, { headers }) as unknown as {
          addEventListener: (
            type: string,
            listener: (evt: { data?: string; message?: string }) => void,
          ) => void;
          close: () => void;
        };
        let settled = false;
        const cleanup = () => {
          if (settled) return;
          settled = true;
          source.close();
        };
        source.addEventListener("progress", (evt) => {
          if (settled || !evt.data) return;
          try {
            onProgress(JSON.parse(evt.data) as SearchProgress);
          } catch {
            // Malformed progress payload is non-fatal; the next valid event recovers.
            // 进度负载格式错误不致命; 下一帧合法事件可恢复.
          }
        });
        source.addEventListener("result", (evt) => {
          if (settled) return;
          try {
            const payload = JSON.parse(evt.data ?? "{}") as Partial<SearchResponse>;
            const results = Array.isArray(payload.results) ? payload.results : [];
            cleanup();
            resolve({ results });
          } catch (err) {
            cleanup();
            reject(err instanceof Error ? err : new Error("malformed result"));
          }
        });
        source.addEventListener("error", (evt) => {
          if (settled) return;
          // Two error shapes: a JSON `data` payload (server-side error) or `message` (transport).
          // 两种错误形态: JSON data (服务端错误) 或 message (传输层).
          let msg = evt.message ?? "search stream failed";
          if (evt.data) {
            try {
              const parsed = JSON.parse(evt.data) as { message?: string };
              if (parsed.message) msg = parsed.message;
            } catch {
              // ignore: fall back to evt.message
            }
          }
          cleanup();
          reject(new Error(msg));
        });
        if (options?.signal) {
          if (options.signal.aborted) {
            cleanup();
            reject(new Error("aborted"));
            return;
          }
          options.signal.addEventListener(
            "abort",
            () => {
              if (settled) return;
              cleanup();
              reject(new Error("aborted"));
            },
            { once: true },
          );
        }
      }),
  };
}
