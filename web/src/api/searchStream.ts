/**
 * searchStream — React-free SSE transport for the /api/v1/search/stream endpoint.
 * searchStream — 用于 /api/v1/search/stream 端点的不依赖 React 的 SSE 传输层.
 *
 * Responsibilities / 职责:
 *   - Fetch the SSE endpoint with optional bearer auth — 携带可选 Bearer 认证请求 SSE 端点
 *   - Decode chunked ReadableStream and reassemble SSE frames — 解码分块 ReadableStream 并重组 SSE 帧
 *   - Dispatch typed SearchStreamEvent to the caller's onEvent callback — 向调用方的 onEvent 回调派发类型化事件
 *   - Handle 401 via onUnauthorized callback (stale-token-safe) — 通过 onUnauthorized 处理 401 (防陈旧 token)
 *
 * Key exports / 主要导出:
 *   SearchStreamOptions, parseSearchStreamEvents, searchStream
 *
 * Callers / 调用方:
 *   client.ts/searchStream (only caller — wraps this function with token store integration)
 *
 * TIER 4 LOCKED — SSE wire format (event/data line structure, event names, JSON shapes)
 * must not change without a matching backend update.
 * Tier 4 锁定 — SSE 线协议 (event/data 行结构、事件名称、JSON 格式) 不得在不同步后端更新的情况下更改.
 */

import type { SearchProgress, SearchResponse, SearchStreamEvent } from "./types";

// SearchStreamOptions keeps the streaming transport independent from React.
// SearchStreamOptions
// 让流式传输层不依赖 React.
export interface SearchStreamOptions {
  query: string;
  page?: number;
  baseURL?: string;
  accessToken?: string;
  fetcher?: typeof fetch;
  signal?: AbortSignal;
  onUnauthorized?: () => void;
  onEvent: (event: SearchStreamEvent) => void;
}

// normalizeBaseURL mirrors the API client URL root rules.
// normalizeBaseURL
// 与普通 API client 的根地址规则保持一致.
function normalizeBaseURL(baseURL: string | undefined): string {
  if (!baseURL || baseURL === "/") {
    return "";
  }

  return baseURL.replace(/\/+$/, "");
}

// parseData keeps JSON decoding typed at each event branch.
// parseData
// 让每个事件分支按目标类型解码 JSON.
function parseData<T>(data: string): T {
  return JSON.parse(data) as T;
}

// parseSearchStreamEvents parses complete SSE event frames separated by blank lines.
// parseSearchStreamEvents
// 解析由空行分隔的完整 SSE 事件帧.
export function parseSearchStreamEvents(text: string): SearchStreamEvent[] {
  return text
    .split(/\r?\n\r?\n/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const lines = chunk.split(/\r?\n/);
      // SSE frames use an event name plus one or more data lines.
      // SSE
      // 帧由事件名和一行或多行 data 组成.
      const event = lines.find((line) => line.startsWith("event:"))?.slice("event:".length).trim();
      const data = lines
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim())
        .join("\n");

      if (event === "progress") {
        return { type: "progress", progress: parseData<SearchProgress>(data) };
      }
      if (event === "result") {
        return { type: "result", response: parseData<SearchResponse>(data) };
      }
      if (event === "error") {
        return { type: "error", message: parseData<{ message?: string }>(data).message ?? "search failed" };
      }
      return { type: "error", message: `unknown search stream event: ${event ?? "missing"}` };
    });
}

// searchStream consumes the protected SSE endpoint with bearer auth support.
// searchStream
// 使用 Bearer 认证消费受保护的 SSE 接口.
export async function searchStream(options: SearchStreamOptions): Promise<void> {
  // root/page/params define the exact stream request URL.
  // root/page/params
  // 共同确定精确的流式搜索请求 URL.
  const root = normalizeBaseURL(options.baseURL);
  const page = options.page ?? 1;
  const params = new URLSearchParams({ q: options.query, page: String(page) });
  // Headers are plain objects so tests can assert Authorization easily.
  // 这里使用普通对象 header, 方便测试断言 Authorization.
  const headers: Record<string, string> = { Accept: "text/event-stream" };

  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }

  const response = await (options.fetcher ?? fetch)(`${root}/api/v1/search/stream?${params.toString()}`, {
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    // Streaming requests only clear auth on 401 when this request actually carried a token.
    // Anonymous browsers should not be kicked out by a 401 on a tokenless request.
    // 流式请求只在本次确实携带 token 时, 401 才清理认证; 匿名浏览不能因 token-less 401 被踢出.
    if (response.status === 401 && !!options.accessToken) {
      options.onUnauthorized?.();
    }
    throw new Error(response.statusText || `Search stream failed with status ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Search stream response body is missing");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  // buffer preserves partial SSE frames split across network chunks.
  // buffer
  // 保存跨网络分块的不完整 SSE 帧.
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });

    const parts = buffer.split(/\r?\n\r?\n/);
    buffer = parts.pop() ?? "";

    for (const part of parts) {
      // Re-add the delimiter so the shared parser sees a complete frame.
      // 补回分隔符, 让共享解析器看到完整事件帧.
      for (const event of parseSearchStreamEvents(`${part}\n\n`)) {
        options.onEvent(event);
      }
    }

    if (done) {
      // Flush a final frame even if the server/proxy omitted the trailing blank line.
      // 即使服务端或代理省略末尾空行, 也要 flush 最后一帧.
      if (buffer.trim()) {
        for (const event of parseSearchStreamEvents(buffer)) {
          options.onEvent(event);
        }
      }
      break;
    }
  }
}
