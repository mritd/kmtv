// viewerHooks tests confirm useDoubanHomeQuery wires queryKey + queryFn correctly.
// viewerHooks 测试确认 useDoubanHomeQuery 正确绑定 queryKey 与 queryFn.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react-native";
import React from "react";

import type { DetailAPI } from "./detail";
import type { DoubanAPI } from "./douban";
import type { SearchAPI } from "./search";
import type { VideoDetail } from "./types";
import {
  RECOMMEND_PAGE_SIZE, useCategoriesQuery, useDoubanHomeQuery,
  useDoubanRecommendInfiniteQuery, useSearchQuery, useVideoDetailQuery,
} from "./viewerHooks";

function wrapper(client: QueryClient) {
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
}

describe("useDoubanHomeQuery", () => {
  it("returns data from the injected DoubanAPI", async () => {
    const payload = { sections: [{ name: "s1", tag: "t", type: "movie", items: [] }] };
    const api: DoubanAPI = {
      doubanHome: jest.fn(async () => payload),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useDoubanHomeQuery(api), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.sections[0]!.name).toBe("s1");
    expect(api.doubanHome).toHaveBeenCalledTimes(1);
  });
});

describe("useCategoriesQuery", () => {
  it("scopes the cache by server and returns metadata", async () => {
    const api: DoubanAPI = {
      doubanHome: jest.fn(),
      doubanCategories: jest.fn(async () => ({ categories: [
        { key: "movie", name: "电影", douban_kind: "movie", format: "", subcategories: [], regions: [] },
      ] })),
      doubanRecommendFilter: jest.fn(),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useCategoriesQuery(api, "https://api.test"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.categories[0]!.key).toBe("movie");
    expect(api.doubanCategories).toHaveBeenCalledTimes(1);
  });
});

describe("useDoubanRecommendInfiniteQuery", () => {
  it("disables when filter.kind is empty", () => {
    const api: DoubanAPI = {
      doubanHome: jest.fn(),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(
      () => useDoubanRecommendInfiniteQuery(api, "s", { kind: "", tag: "", format: "", region: "" }),
      { wrapper: wrapper(qc) },
    );
    expect(api.doubanRecommendFilter).not.toHaveBeenCalled();
  });

  it("fetches the first page with start=0 / count=RECOMMEND_PAGE_SIZE", async () => {
    const api: DoubanAPI = {
      doubanHome: jest.fn(),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(async () => ({ items: [] })),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useDoubanRecommendInfiniteQuery(api, "s", { kind: "movie", tag: "", format: "", region: "" }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.doubanRecommendFilter).toHaveBeenCalledTimes(1);
    expect(api.doubanRecommendFilter).toHaveBeenCalledWith({
      kind: "movie", tag: "", format: "", region: "", start: 0, count: RECOMMEND_PAGE_SIZE,
    });
  });

  it("returns hasNextPage=false when last page is short", async () => {
    const api: DoubanAPI = {
      doubanHome: jest.fn(),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(async () => ({ items: new Array(5).fill({
        id: "x", title: "x", cover: "", rate: "", year: "",
      }) })),
    };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useDoubanRecommendInfiniteQuery(api, "s", { kind: "movie", tag: "", format: "", region: "" }),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.hasNextPage).toBe(false);
  });
});

describe("useSearchQuery", () => {
  it("disabled when query trimmed empty", () => {
    const api: SearchAPI = { search: jest.fn(), searchStream: jest.fn() };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHook(() => useSearchQuery(api, "s", "  "), { wrapper: wrapper(qc) });
    expect(api.search).not.toHaveBeenCalled();
  });

  it("runs sync search via SearchAPI when query non-empty", async () => {
    const api: SearchAPI = { search: jest.fn(async () => ({ results: [] })), searchStream: jest.fn() };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useSearchQuery(api, "s", "hello"), { wrapper: wrapper(qc) });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.search).toHaveBeenCalledWith("hello");
  });
});

describe("useVideoDetailQuery", () => {
  const detail: VideoDetail = {
    id: "1", title: "T", type: "Movie", year: "2024", cover: "c", desc: "",
    director: "", actor: "", area: "", episodes: [[{ name: "01", url: "u" }]],
  };

  it("fetches when both source key and video id are non-empty", async () => {
    const api: DetailAPI = { detail: jest.fn(async () => detail) };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useVideoDetailQuery(api, "srv", "k1", "v1"),
      { wrapper: wrapper(qc) },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(api.detail).toHaveBeenCalledWith("k1", "v1");
    expect(result.current.data?.title).toBe("T");
  });

  it("stays disabled while sourceKey is empty", () => {
    const api: DetailAPI = { detail: jest.fn() };
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(
      () => useVideoDetailQuery(api, "srv", "", "v1"),
      { wrapper: wrapper(qc) },
    );
    expect(result.current.fetchStatus).toBe("idle");
    expect(api.detail).not.toHaveBeenCalled();
  });
});
