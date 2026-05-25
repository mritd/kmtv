import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { describe, expect, it } from "vitest";

import { createTestAPI } from "@/test/testAPI";
import { APIProvider } from "./context";
import {
  useDetailQuery,
  useDoubanHomeQuery,
  usePlaybackURLMutation,
  useSearchQuery,
} from "./viewerHooks";

// makeWrapper creates a minimal QueryClient + APIProvider wrapper for hook tests.
// makeWrapper
// 为 hook 测试创建最小的 QueryClient + APIProvider 包装器.
function makeWrapper(api = createTestAPI()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <APIProvider value={api}>{children}</APIProvider>
      </QueryClientProvider>
    );
  };
}

describe("useDoubanHomeQuery", () => {
  it("returns sections on success", async () => {
    const api = createTestAPI({
      doubanHome: async () => ({
        sections: [{ name: "热门电影", items: [{ id: "1", title: "流浪地球" }] }],
      }),
    });
    const { result } = renderHook(() => useDoubanHomeQuery(), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sections).toHaveLength(1);
    expect(result.current.data?.sections[0].name).toBe("热门电影");
  });

  it("surfaces error state when doubanHome rejects", async () => {
    const api = createTestAPI({
      doubanHome: async () => { throw new Error("Douban unavailable"); },
    });
    // retry: 1 on the hook means we need to wait for both attempts.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <APIProvider value={api}>{children}</APIProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDoubanHomeQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), { timeout: 5000 });
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useSearchQuery", () => {
  it("returns results when query is non-empty", async () => {
    const api = createTestAPI({
      search: async () => ({
        results: [{ title: "灌篮高手", sources: [{ source_key: "src-a", source_name: "A", video_id: "1" }] }],
      }),
    });
    const { result } = renderHook(() => useSearchQuery("灌篮高手"), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results[0].title).toBe("灌篮高手");
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(() => useSearchQuery(""), { wrapper: makeWrapper() });
    // fetchStatus idle means the query never fired.
    // fetchStatus 为 idle 表示查询从未触发.
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("is disabled when query is whitespace only", async () => {
    const { result } = renderHook(() => useSearchQuery("   "), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces error state when search rejects", async () => {
    const api = createTestAPI({
      search: async () => { throw new Error("network error"); },
    });
    const { result } = renderHook(() => useSearchQuery("test"), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useDetailQuery", () => {
  it("returns detail on success", async () => {
    const api = createTestAPI({
      detail: async (source, id) => ({
        id,
        title: "Demo Movie",
        episodes: [[{ name: "EP1", url: "https://cdn.example/ep1.m3u8" }]],
      }),
    });
    const { result } = renderHook(() => useDetailQuery("source-a", "9"), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Demo Movie");
    expect(result.current.data?.id).toBe("9");
  });

  it("is disabled when source is empty", async () => {
    const { result } = renderHook(() => useDetailQuery("", "9"), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when id is empty", async () => {
    const { result } = renderHook(() => useDetailQuery("source-a", ""), { wrapper: makeWrapper() });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces error state when detail rejects", async () => {
    const api = createTestAPI({
      detail: async () => { throw new Error("not found"); },
    });
    const { result } = renderHook(() => useDetailQuery("source-a", "9"), { wrapper: makeWrapper(api) });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("usePlaybackURLMutation", () => {
  it("resolves playback URL on success", async () => {
    const api = createTestAPI({
      playbackURL: async (url) => ({ mode: "proxy", url: `https://proxy.example?url=${url}` }),
    });
    const { result } = renderHook(() => usePlaybackURLMutation("source-a"), { wrapper: makeWrapper(api) });
    result.current.mutate({ name: "EP1", url: "https://cdn.example/ep1.m3u8" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.mode).toBe("proxy");
    expect(result.current.data?.url).toContain("https://proxy.example");
  });

  it("passes the source key to the API", async () => {
    let capturedSource: string | undefined;
    const api = createTestAPI({
      playbackURL: async (url, source) => {
        capturedSource = source;
        return { mode: "direct", url };
      },
    });
    const { result } = renderHook(() => usePlaybackURLMutation("source-b"), { wrapper: makeWrapper(api) });
    result.current.mutate({ name: "EP1", url: "https://cdn.example/ep1.m3u8" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedSource).toBe("source-b");
  });

  it("surfaces error state when playbackURL rejects", async () => {
    const api = createTestAPI({
      playbackURL: async () => { throw new Error("DRM error"); },
    });
    const { result } = renderHook(() => usePlaybackURLMutation("source-a"), { wrapper: makeWrapper(api) });
    result.current.mutate({ name: "EP1", url: "https://cdn.example/ep1.m3u8" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});
