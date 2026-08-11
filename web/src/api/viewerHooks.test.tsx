/**
 * viewerHooks.test — focused React Query hook coverage for viewer-facing API resources.
 *
 * viewerHooks.test — 面向观看者 API 资源的 React Query hooks 聚焦测试.
 *
 * Responsibilities / 职责:
 *   - Verify query enablement, key shape, pagination, and mutation boundaries — 验证查询启用、key 形态、分页与 mutation 边界
 *   - Guard user-scoped watch-history cache isolation — 守护用户作用域观看历史缓存隔离
 *
 * Callers / 调用方:
 *   Vitest test runner — Vitest 测试运行器
 *
 * ADR locks / ADR 锁定:
 *   ADR-014 requires bilingual module documentation for TypeScript files under web/src.
 *   ADR-015 requires server-origin and user-ID isolation for watch history.
 *
 *   ADR-014 要求 web/src 下的 TypeScript 文件具备双语模块文档.
 *   ADR-015 要求观看历史按 server origin 与用户 ID 隔离.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createTestAPI } from "@/test/testAPI";
import { nextWatchHistoryEventTime } from "@/storage/watchHistoryClock";
import type {
  DoubanItem,
  DoubanRecommendFilter,
  WatchHistoryItem,
  WatchHistoryResponse,
} from "./types";
import { APIProvider } from "./context";
import {
  RECOMMEND_PAGE_SIZE,
  WATCH_HISTORY_LIMIT,
  type WatchHistoryScope,
  useClearWatchHistoryMutation,
  useCategoriesQuery,
  useDetailQuery,
  useDoubanHomeQuery,
  useDoubanRecommendInfiniteQuery,
  usePlaybackURLMutation,
  useSaveWatchHistoryMutation,
  useSearchQuery,
  useWatchHistoryQuery,
} from "./viewerHooks";

// makeItems builds a page of `n` placeholder Douban items with sequential ids offset by `start`.
// makeItems
//
// 构造一页 n 条占位豆瓣条目, id 从 start 起递增.
function makeItems(n: number, start = 0): DoubanItem[] {
  return Array.from({ length: n }, (_, i) => ({
    id: String(start + i),
    title: `Item ${start + i}`,
  }));
}

// makeHistoryItem builds a minimal server-synchronized watch-history entry.
// makeHistoryItem
//
// 构造一条最小的服务端同步观看历史记录.
function makeHistoryItem(title: string): WatchHistoryItem {
  return {
    id: 1,
    source_key: "source-a",
    video_id: "video-a",
    title,
    cover: "",
    episode: "EP1",
    group_index: 0,
    episode_index: 0,
    progress_sec: 120,
    duration_sec: 1200,
    completed: false,
    event_time_ms: 1000,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
  };
}

// deferred creates a manually resolved Promise for query race tests.
// deferred
//
// 为 query race 测试创建一个手动 resolve 的 Promise.
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// makeWrapper creates a minimal QueryClient + APIProvider wrapper for hook tests.
// makeWrapper
//
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

// makeHarness creates a wrapper plus its QueryClient when tests need cache assertions.
// makeHarness
//
// 当测试需要断言缓存时, 创建 wrapper 及其 QueryClient.
function makeHarness(api = createTestAPI()) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <APIProvider value={api}>{children}</APIProvider>
    </QueryClientProvider>
  );
  return { queryClient, wrapper };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("useDoubanHomeQuery", () => {
  it("returns sections on success", async () => {
    const api = createTestAPI({
      doubanHome: async () => ({
        sections: [
          { name: "热门电影", items: [{ id: "1", title: "流浪地球" }] },
        ],
      }),
    });
    const { result } = renderHook(() => useDoubanHomeQuery(), {
      wrapper: makeWrapper(api),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sections).toHaveLength(1);
    expect(result.current.data?.sections[0].name).toBe("热门电影");
  });

  it("surfaces error state when doubanHome rejects", async () => {
    const api = createTestAPI({
      doubanHome: async () => {
        throw new Error("Douban unavailable");
      },
    });
    // retry: 1 on the hook means we need to wait for both attempts.
    //
    // hook 设置 retry: 1, 因此需要等待两次尝试全部完成.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <APIProvider value={api}>{children}</APIProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useDoubanHomeQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useCategoriesQuery", () => {
  it("returns category groups on success", async () => {
    const api = createTestAPI({
      doubanCategories: async () => ({
        categories: [
          {
            key: "movie",
            name: "电影",
            douban_kind: "movie",
            format: "",
            subcategories: [],
            regions: [],
          },
        ],
      }),
    });
    const { result } = renderHook(() => useCategoriesQuery(), {
      wrapper: makeWrapper(api),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.categories[0].key).toBe("movie");
  });

  it("surfaces error state when doubanCategories rejects", async () => {
    const api = createTestAPI({
      doubanCategories: async () => {
        throw new Error("Douban unavailable");
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: 1 }, mutations: { retry: false } },
    });
    const wrapper = ({ children }: { children: React.ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <APIProvider value={api}>{children}</APIProvider>
      </QueryClientProvider>
    );
    const { result } = renderHook(() => useCategoriesQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 5000,
    });
  });
});

describe("useDoubanRecommendInfiniteQuery", () => {
  const filter = { kind: "movie", tag: "喜剧", format: "", region: "美国" };

  it("is disabled when kind is empty", async () => {
    const { result } = renderHook(
      () =>
        useDoubanRecommendInfiniteQuery({
          kind: "",
          tag: "",
          format: "",
          region: "",
        }),
      { wrapper: makeWrapper() },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("forwards the resolved filter and pagination to the API", async () => {
    let captured: DoubanRecommendFilter | undefined;
    const api = createTestAPI({
      doubanRecommendFilter: async (f) => {
        captured = f;
        return { items: makeItems(RECOMMEND_PAGE_SIZE) };
      },
    });
    const { result } = renderHook(
      () => useDoubanRecommendInfiniteQuery(filter),
      { wrapper: makeWrapper(api) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(captured).toMatchObject({
      kind: "movie",
      tag: "喜剧",
      region: "美国",
      start: 0,
      count: RECOMMEND_PAGE_SIZE,
    });
  });

  it("advances the start offset by the cumulative item count when fetching the next page", async () => {
    const starts: (number | undefined)[] = [];
    const api = createTestAPI({
      doubanRecommendFilter: async (f) => {
        starts.push(f.start);
        return { items: makeItems(RECOMMEND_PAGE_SIZE, f.start ?? 0) };
      },
    });
    const { result } = renderHook(
      () => useDoubanRecommendInfiniteQuery(filter),
      { wrapper: makeWrapper(api) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(true);

    result.current.fetchNextPage();
    await waitFor(() => expect(result.current.isFetchingNextPage).toBe(false));
    await waitFor(() => expect(result.current.data?.pages).toHaveLength(2));
    expect(starts).toEqual([0, RECOMMEND_PAGE_SIZE]);
  });

  it("stops paginating when a short page signals the end of the list", async () => {
    const api = createTestAPI({
      doubanRecommendFilter: async () => ({
        items: makeItems(RECOMMEND_PAGE_SIZE - 1),
      }),
    });
    const { result } = renderHook(
      () => useDoubanRecommendInfiniteQuery(filter),
      { wrapper: makeWrapper(api) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useSearchQuery", () => {
  it("returns results when query is non-empty", async () => {
    const api = createTestAPI({
      search: async () => ({
        results: [
          {
            title: "灌篮高手",
            sources: [{ source_key: "src-a", source_name: "A", video_id: "1" }],
          },
        ],
      }),
    });
    const { result } = renderHook(() => useSearchQuery("灌篮高手"), {
      wrapper: makeWrapper(api),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.results[0].title).toBe("灌篮高手");
  });

  it("is disabled when query is empty", async () => {
    const { result } = renderHook(() => useSearchQuery(""), {
      wrapper: makeWrapper(),
    });
    // fetchStatus idle means the query never fired.
    //
    // fetchStatus 为 idle 表示查询从未触发.
    expect(result.current.fetchStatus).toBe("idle");
    expect(result.current.data).toBeUndefined();
  });

  it("is disabled when query is whitespace only", async () => {
    const { result } = renderHook(() => useSearchQuery("   "), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces error state when search rejects", async () => {
    const api = createTestAPI({
      search: async () => {
        throw new Error("network error");
      },
    });
    const { result } = renderHook(() => useSearchQuery("test"), {
      wrapper: makeWrapper(api),
    });
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
    const { result } = renderHook(() => useDetailQuery("source-a", "9"), {
      wrapper: makeWrapper(api),
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.title).toBe("Demo Movie");
    expect(result.current.data?.id).toBe("9");
  });

  it("is disabled when source is empty", async () => {
    const { result } = renderHook(() => useDetailQuery("", "9"), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("is disabled when id is empty", async () => {
    const { result } = renderHook(() => useDetailQuery("source-a", ""), {
      wrapper: makeWrapper(),
    });
    expect(result.current.fetchStatus).toBe("idle");
  });

  it("surfaces error state when detail rejects", async () => {
    const api = createTestAPI({
      detail: async () => {
        throw new Error("not found");
      },
    });
    const { result } = renderHook(() => useDetailQuery("source-a", "9"), {
      wrapper: makeWrapper(api),
    });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("usePlaybackURLMutation", () => {
  it("resolves playback URL on success", async () => {
    const api = createTestAPI({
      playbackURL: async (url) => ({
        mode: "proxy",
        url: `https://proxy.example?url=${url}`,
      }),
    });
    const { result } = renderHook(() => usePlaybackURLMutation("source-a"), {
      wrapper: makeWrapper(api),
    });
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
    const { result } = renderHook(() => usePlaybackURLMutation("source-b"), {
      wrapper: makeWrapper(api),
    });
    result.current.mutate({ name: "EP1", url: "https://cdn.example/ep1.m3u8" });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(capturedSource).toBe("source-b");
  });

  it("surfaces error state when playbackURL rejects", async () => {
    const api = createTestAPI({
      playbackURL: async () => {
        throw new Error("DRM error");
      },
    });
    const { result } = renderHook(() => usePlaybackURLMutation("source-a"), {
      wrapper: makeWrapper(api),
    });
    result.current.mutate({ name: "EP1", url: "https://cdn.example/ep1.m3u8" });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(Error);
  });
});

describe("useWatchHistoryQuery", () => {
  const scope = {
    serverOrigin: "https://kmtv.example",
    userID: 42,
    isAuthenticated: true,
  };

  it("requests ten incomplete items under a server and user scoped key", async () => {
    let capturedLimit: number | undefined;
    const api = createTestAPI({
      listWatchHistory: async (limit) => {
        capturedLimit = limit;
        return { items: [makeHistoryItem("Demo Show")] };
      },
    });
    const { queryClient, wrapper } = makeHarness(api);
    const { result } = renderHook(() => useWatchHistoryQuery(scope), {
      wrapper,
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(capturedLimit).toBe(WATCH_HISTORY_LIMIT);
    expect(
      queryClient.getQueryData([
        "watch-history",
        scope.serverOrigin,
        scope.userID,
        WATCH_HISTORY_LIMIT,
      ]),
    ).toEqual({
      items: [makeHistoryItem("Demo Show")],
    });
  });

  it.each([
    [
      "anonymous",
      {
        serverOrigin: "https://kmtv.example",
        userID: 0,
        isAuthenticated: false,
      },
    ],
    [
      "stale authenticated flag with anonymous user ID",
      {
        serverOrigin: "https://kmtv.example",
        userID: 0,
        isAuthenticated: true,
      },
    ],
    [
      "negative user ID",
      {
        serverOrigin: "https://kmtv.example",
        userID: -1,
        isAuthenticated: true,
      },
    ],
  ] satisfies [string, WatchHistoryScope][])(
    "is disabled for %s",
    async (_name, disabledScope) => {
      const listWatchHistory = vi.fn(async () => ({
        items: [makeHistoryItem("Should Not Load")],
      }));
      const api = createTestAPI({ listWatchHistory });
      const { result } = renderHook(() => useWatchHistoryQuery(disabledScope), {
        wrapper: makeWrapper(api),
      });

      expect(result.current.fetchStatus).toBe("idle");
      expect(result.current.data).toBeUndefined();
      expect(listWatchHistory).not.toHaveBeenCalled();
    },
  );

  it("keeps late responses isolated to the identity that started them", async () => {
    const first = deferred<WatchHistoryResponse>();
    const second = deferred<WatchHistoryResponse>();
    const listWatchHistory = vi
      .fn<() => Promise<WatchHistoryResponse>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const api = createTestAPI({ listWatchHistory });
    const { queryClient, wrapper } = makeHarness(api);
    const initialScope = {
      serverOrigin: "https://kmtv.example",
      userID: 1,
      isAuthenticated: true,
    };
    const nextScope = {
      serverOrigin: "https://kmtv.example",
      userID: 2,
      isAuthenticated: true,
    };
    const { result, rerender } = renderHook(
      ({ activeScope }) => useWatchHistoryQuery(activeScope),
      {
        initialProps: { activeScope: initialScope },
        wrapper,
      },
    );

    await waitFor(() => expect(listWatchHistory).toHaveBeenCalledTimes(1));
    rerender({ activeScope: nextScope });
    await waitFor(() => expect(listWatchHistory).toHaveBeenCalledTimes(2));

    await act(async () => {
      second.resolve({ items: [makeHistoryItem("New User Show")] });
      await second.promise;
    });
    await waitFor(() =>
      expect(result.current.data?.items[0].title).toBe("New User Show"),
    );

    await act(async () => {
      first.resolve({ items: [makeHistoryItem("Old User Show")] });
      await first.promise;
    });

    expect(
      queryClient.getQueryData([
        "watch-history",
        "https://kmtv.example",
        1,
        WATCH_HISTORY_LIMIT,
      ]),
    ).toEqual({
      items: [makeHistoryItem("Old User Show")],
    });
    expect(
      queryClient.getQueryData([
        "watch-history",
        "https://kmtv.example",
        2,
        WATCH_HISTORY_LIMIT,
      ]),
    ).toEqual({
      items: [makeHistoryItem("New User Show")],
    });
    expect(result.current.data?.items[0].title).toBe("New User Show");
  });
});

describe("useSaveWatchHistoryMutation", () => {
  const scope = {
    serverOrigin: "https://kmtv.example",
    userID: 42,
    isAuthenticated: true,
  };
  const queryKey = [
    "watch-history",
    scope.serverOrigin,
    scope.userID,
    WATCH_HISTORY_LIMIT,
  ] as const;

  it("writes the successful PUT response into only the exact scoped incomplete-history cache", async () => {
    const saved = {
      ...makeHistoryItem("Saved Show"),
      id: 7,
      event_time_ms: 5000,
      progress_sec: 333,
    };
    const saveWatchHistory = vi.fn(async () => saved);
    const listWatchHistory = vi.fn(async () => ({
      items: [makeHistoryItem("Should Not Refetch")],
    }));
    const api = createTestAPI({ saveWatchHistory, listWatchHistory });
    const { queryClient, wrapper } = makeHarness(api);
    const otherKey = [
      "watch-history",
      "https://kmtv.example",
      99,
      WATCH_HISTORY_LIMIT,
    ] as const;
    queryClient.setQueryData(queryKey, {
      items: [makeHistoryItem("Old Show")],
    });
    queryClient.setQueryData(otherKey, {
      items: [makeHistoryItem("Other User Show")],
    });

    const { result } = renderHook(() => useSaveWatchHistoryMutation(scope), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        source_key: "source-a",
        video_id: "video-a",
        title: "Saved Show",
        cover: "",
        episode: "EP1",
        group_index: 0,
        episode_index: 0,
        progress_sec: 333,
        duration_sec: 1200,
        completed: false,
        event_time_ms: 5000,
      });
    });

    expect(saveWatchHistory).toHaveBeenCalledTimes(1);
    expect(listWatchHistory).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: [saved, makeHistoryItem("Old Show")],
    });
    expect(queryClient.getQueryData(otherKey)).toEqual({
      items: [makeHistoryItem("Other User Show")],
    });
  });

  it("keeps a completed title out of the incomplete-history cache even when the cache did not contain it yet", async () => {
    const completed = {
      ...makeHistoryItem("Completed Show"),
      completed: true,
      event_time_ms: 6000,
    };
    const api = createTestAPI({ saveWatchHistory: async () => completed });
    const { queryClient, wrapper } = makeHarness(api);
    queryClient.setQueryData(queryKey, {
      items: [makeHistoryItem("Keep Show")],
    });

    const { result } = renderHook(() => useSaveWatchHistoryMutation(scope), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        source_key: "source-a",
        video_id: "video-a",
        title: "Completed Show",
        cover: "",
        episode: "EP1",
        group_index: 0,
        episode_index: 0,
        progress_sec: 1200,
        duration_sec: 1200,
        completed: true,
        event_time_ms: 6000,
      });
    });

    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: [makeHistoryItem("Keep Show")],
    });
  });

  it("keeps the invocation cache key when scope changes while PUT is pending", async () => {
    const pendingSave = deferred<WatchHistoryItem>();
    const api = createTestAPI({
      saveWatchHistory: async () => pendingSave.promise,
    });
    const { queryClient, wrapper } = makeHarness(api);
    const firstScope = {
      serverOrigin: "https://kmtv.example",
      userID: 1,
      isAuthenticated: true,
    };
    const nextScope = {
      serverOrigin: "https://kmtv.example",
      userID: 2,
      isAuthenticated: true,
    };
    const firstKey = [
      "watch-history",
      firstScope.serverOrigin,
      firstScope.userID,
      WATCH_HISTORY_LIMIT,
    ] as const;
    const nextKey = [
      "watch-history",
      nextScope.serverOrigin,
      nextScope.userID,
      WATCH_HISTORY_LIMIT,
    ] as const;
    queryClient.setQueryData(firstKey, {
      items: [makeHistoryItem("First User Show")],
    });
    queryClient.setQueryData(nextKey, {
      items: [makeHistoryItem("Next User Show")],
    });

    const { result, rerender } = renderHook(
      ({ activeScope }) => useSaveWatchHistoryMutation(activeScope),
      {
        initialProps: { activeScope: firstScope },
        wrapper,
      },
    );
    act(() =>
      result.current.mutate({
        source_key: "source-a",
        video_id: "video-a",
        title: "Late Save",
        cover: "",
        episode: "EP1",
        group_index: 0,
        episode_index: 0,
        progress_sec: 10,
        duration_sec: 1200,
        completed: false,
        event_time_ms: 7000,
      }),
    );
    await waitFor(() => expect(result.current.isPending).toBe(true));
    rerender({ activeScope: nextScope });

    await act(async () => {
      pendingSave.resolve({
        ...makeHistoryItem("Late Save"),
        event_time_ms: 7000,
      });
      await pendingSave.promise;
    });

    expect(queryClient.getQueryData(firstKey)).toEqual({
      items: [
        { ...makeHistoryItem("Late Save"), event_time_ms: 7000 },
        makeHistoryItem("First User Show"),
      ],
    });
    expect(queryClient.getQueryData(nextKey)).toEqual({
      items: [makeHistoryItem("Next User Show")],
    });
  });
});

describe("useClearWatchHistoryMutation", () => {
  const scope = {
    serverOrigin: "https://kmtv.example",
    userID: 42,
    isAuthenticated: true,
  };
  const queryKey = [
    "watch-history",
    scope.serverOrigin,
    scope.userID,
    WATCH_HISTORY_LIMIT,
  ] as const;

  it("cancels the exact scoped read before DELETE and empties only that cache entry", async () => {
    const staleRead = deferred<WatchHistoryResponse>();
    const events: string[] = [];
    let clearEventTime: number | undefined;
    const api = createTestAPI({
      listWatchHistory: async () => {
        events.push("get");
        return staleRead.promise;
      },
      clearWatchHistory: async (eventTimeMS) => {
        clearEventTime = eventTimeMS;
        events.push("delete");
      },
    });
    const { queryClient, wrapper } = makeHarness(api);
    const otherKey = [
      "watch-history",
      "https://kmtv.example",
      99,
      WATCH_HISTORY_LIMIT,
    ] as const;
    queryClient.setQueryData(otherKey, {
      items: [makeHistoryItem("Other User Show")],
    });
    const cancelSpy = vi.spyOn(queryClient, "cancelQueries");

    const { result } = renderHook(
      () => ({
        history: useWatchHistoryQuery(scope),
        clear: useClearWatchHistoryMutation(scope),
      }),
      { wrapper },
    );
    await waitFor(() => expect(events).toEqual(["get"]));

    vi.useFakeTimers({ now: 1_808_000_000_000, shouldAdvanceTime: false });
    const previousEventTime = nextWatchHistoryEventTime();
    await act(async () => {
      await result.current.clear.mutateAsync();
    });

    expect(cancelSpy).toHaveBeenCalledWith({ queryKey, exact: true });
    expect(events).toEqual(["get", "delete"]);
    expect(clearEventTime).toBeGreaterThan(previousEventTime);
    expect(queryClient.getQueryData(queryKey)).toEqual({ items: [] });
    expect(queryClient.getQueryData(otherKey)).toEqual({
      items: [makeHistoryItem("Other User Show")],
    });

    await act(async () => {
      staleRead.resolve({ items: [makeHistoryItem("Stale Show")] });
      await staleRead.promise;
    });

    expect(queryClient.getQueryData(queryKey)).toEqual({ items: [] });
  });

  it("preserves a cache checkpoint that is logically newer than the pending clear", async () => {
    const pendingDelete = deferred<void>();
    let clearEventTime: number | undefined;
    const api = createTestAPI({
      clearWatchHistory: async (eventTimeMS) => {
        clearEventTime = eventTimeMS;
        await pendingDelete.promise;
      },
    });
    const { queryClient, wrapper } = makeHarness(api);
    queryClient.setQueryData(queryKey, { items: [makeHistoryItem("Before Clear")] });
    const { result } = renderHook(() => useClearWatchHistoryMutation(scope), { wrapper });

    act(() => result.current.mutate());
    await waitFor(() => expect(clearEventTime).toBeDefined());
    const clearTime = clearEventTime!;
    act(() => {
      queryClient.setQueryData(queryKey, {
        items: [
          { ...makeHistoryItem("After Clear"), event_time_ms: clearTime + 1 },
          { ...makeHistoryItem("Before Clear"), event_time_ms: clearTime - 1 },
        ],
      });
    });

    await act(async () => {
      pendingDelete.resolve();
      await pendingDelete.promise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(queryKey)).toEqual({
      items: [{ ...makeHistoryItem("After Clear"), event_time_ms: clearTime + 1 }],
    });
  });

  it("keeps the invocation identity when scope changes while DELETE is pending", async () => {
    const pendingDelete = deferred<void>();
    const api = createTestAPI({
      clearWatchHistory: async () => pendingDelete.promise,
    });
    const { queryClient, wrapper } = makeHarness(api);
    const firstScope = {
      serverOrigin: "https://kmtv.example",
      userID: 1,
      isAuthenticated: true,
    };
    const nextScope = {
      serverOrigin: "https://kmtv.example",
      userID: 2,
      isAuthenticated: true,
    };
    const firstKey = [
      "watch-history",
      firstScope.serverOrigin,
      firstScope.userID,
      WATCH_HISTORY_LIMIT,
    ] as const;
    const nextKey = [
      "watch-history",
      nextScope.serverOrigin,
      nextScope.userID,
      WATCH_HISTORY_LIMIT,
    ] as const;
    queryClient.setQueryData(firstKey, {
      items: [makeHistoryItem("First User Show")],
    });
    queryClient.setQueryData(nextKey, {
      items: [makeHistoryItem("Next User Show")],
    });

    const { result, rerender } = renderHook(
      ({ activeScope }) => useClearWatchHistoryMutation(activeScope),
      {
        initialProps: { activeScope: firstScope },
        wrapper,
      },
    );

    act(() => result.current.mutate());
    await waitFor(() => expect(result.current.isPending).toBe(true));
    rerender({ activeScope: nextScope });

    await act(async () => {
      pendingDelete.resolve();
      await pendingDelete.promise;
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryData(firstKey)).toEqual({ items: [] });
    expect(queryClient.getQueryData(nextKey)).toEqual({
      items: [makeHistoryItem("Next User Show")],
    });
  });
});
