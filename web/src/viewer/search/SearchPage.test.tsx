/**
 * SearchPage integration tests cover streamed progress and results, query replacement,
 * malformed-source filtering, detail navigation, and favorite synchronization.
 *
 * SearchPage 集成测试覆盖流式进度与结果, 查询替换, 异常来源过滤, 详情导航和收藏同步.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { APIClient } from "@/api/client";
import { APIProvider } from "@/api/context";
import type { SearchResult, SearchStreamEvent } from "@/api/types";
import { detailRoutePath } from "@/storage/detailRoute";
import { sourceBundleStorageKey } from "@/storage/sourceBundles";
import { searchStore } from "@/store/searchStore";
import { SyncValueProvider } from "@/sync/SyncContext";
import type { SyncStore } from "@/sync/syncStore";
import { favoriteFromSearchResult } from "@/sync/kinds";
import { openSyncStore } from "@/test/syncFixtures";
import { createTestAPI } from "@/test/testAPI";

import { SearchPage } from "./SearchPage";

type TestSearchStream = APIClient["searchStream"];

function renderSearch({
  initialEntry = "/search?q=Movie",
  searchStream,
  store = openSyncStore(0, ""),
}: {
  initialEntry?: string;
  searchStream?: TestSearchStream;
  store?: SyncStore;
} = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createTestAPI({
    searchStream: searchStream ?? (async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
      onEvent({ type: "progress", progress: { phase: "searching", completed: 1, total: 3 } });
      onEvent({ type: "progress", progress: { phase: "probing", completed: 2, total: 5 } });
      onEvent({ type: "result", response: { results: [{ title: "Movie", year: "2026", sources: [] }] } });
    }),
  });

  render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <SyncValueProvider value={{ status: "ready", store, engine: null }}>
          <MemoryRouter initialEntries={[initialEntry]}>
            <Routes>
              <Route path="/search" element={<SearchPage />} />
              <Route path="/detail/:token" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </SyncValueProvider>
      </QueryClientProvider>
    </APIProvider>,
  );

  return { api, store };
}

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div aria-label="Current path">{location.pathname}</div>
      <div aria-label="Navigation state">{JSON.stringify(location.state)}</div>
    </>
  );
}

function result(title: string): SearchResult {
  return {
    title,
    year: "2026",
    sources: [
      { source_key: "source-a", source_name: "Source A", video_id: "video-1", duration_ms: 900 },
      { source_key: "source-b", source_name: "Source B", video_id: "video-2", duration_ms: 240 },
    ],
  };
}

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("SearchPage", () => {
  it("renders SSE phase progress and final results", async () => {
    renderSearch();

    expect(await screen.findByText("搜索视频源")).toBeInTheDocument();
    expect(screen.getByText("1 / 3")).toBeInTheDocument();
    expect(await screen.findByText("探测可播放线路")).toBeInTheDocument();
    expect(screen.getByText("2 / 5")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("heading", { name: "Movie" })).toBeInTheDocument());
  });

  it("marks completed and active search progress phases", async () => {
    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({ type: "progress", progress: { phase: "searching", completed: 39, total: 39 } });
        onEvent({ type: "progress", progress: { phase: "probing", completed: 108, total: 150 } });
        onEvent({ type: "result", response: { results: [] } });
      },
    });

    const searchingCard = await screen.findByText("搜索视频源");
    const probingCard = await screen.findByText("探测可播放线路");

    expect(searchingCard.closest(".search-phase-card")).toHaveClass("search-phase-card-done");
    expect(probingCard.closest(".search-phase-card")).toHaveClass("search-phase-card-active");
  });

  it("treats null streamed result lists as empty results", async () => {
    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        // Runtime payloads can violate API types, so this test feeds the unsafe JSON shape directly.
        //
        // 运行时 payload 可能违反 API 类型, 所以这里直接输入不安全 JSON 形状.
        onEvent({ type: "result", response: { results: null } } as unknown as SearchStreamEvent);
      },
    });

    expect(await screen.findByText("没有搜索结果")).toBeInTheDocument();
  });

  it("treats null streamed source lists as unavailable results", async () => {
    const user = userEvent.setup();
    const { store } = renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        // Runtime payloads can contain null sources from upstream aggregation.
        //
        // 运行时 payload 可能包含上游聚合返回的 null sources.
        onEvent({ type: "result", response: { results: [{ title: "Unsafe Movie", sources: null }] } } as unknown as SearchStreamEvent);
      },
    });

    expect(await screen.findByRole("heading", { name: "Unsafe Movie" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂无来源" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "收藏" }));
    expect(store.get("favorite", "Unsafe Movie")).toBeNull();
  });

  it("aborts pending streams and ignores stale events after query changes", async () => {
    const user = userEvent.setup();
    let staleSignal: AbortSignal | undefined;
    let staleOnEvent: ((event: SearchStreamEvent) => void) | undefined;
    const searchStream = vi.fn(async (query: string, onEvent: (event: SearchStreamEvent) => void, options?: { signal?: AbortSignal }) => {
      if (query === "A") {
        staleSignal = options?.signal;
        staleOnEvent = onEvent;
        return new Promise<void>(() => undefined);
      }

      onEvent({ type: "result", response: { results: [result("Fresh Movie")] } });
    });

    renderSearch({ initialEntry: "/search?q=A", searchStream });

    await waitFor(() => expect(searchStream).toHaveBeenCalledWith("A", expect.any(Function), expect.any(Object)));
    await user.clear(screen.getByLabelText("搜索关键词"));
    await user.type(screen.getByLabelText("搜索关键词"), "B");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(staleSignal?.aborted).toBe(true));
    expect(await screen.findByRole("heading", { name: "Fresh Movie" })).toBeInTheDocument();

    act(() => staleOnEvent?.({ type: "result", response: { results: [result("Stale Movie")] } }));

    expect(screen.getByRole("heading", { name: "Fresh Movie" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Stale Movie" })).toBeNull();
  });

  it("retries the same query after a stream error", async () => {
    const user = userEvent.setup();
    const searchStream = vi
      .fn<TestSearchStream>()
      .mockImplementationOnce(async (_query, onEvent) => {
        onEvent({ type: "error", message: "stream failed" });
      })
      .mockImplementationOnce(async (_query, onEvent) => {
        onEvent({ type: "result", response: { results: [result("Recovered Movie")] } });
      });

    renderSearch({ searchStream });

    expect(await screen.findByText("搜索失败")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "重试" }));

    await waitFor(() => expect(searchStream).toHaveBeenCalledTimes(2));
    expect(searchStream.mock.calls.map(([query]) => query)).toEqual(["Movie", "Movie"]);
    expect(await screen.findByRole("heading", { name: "Recovered Movie" })).toBeInTheDocument();
    expect(screen.queryByText("搜索失败")).toBeNull();
  });

  it("preserves playback navigation and favorite behavior for streamed results", async () => {
    const user = userEvent.setup();
    const { store } = renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({ type: "result", response: { results: [result("Playable Movie")] } });
      },
    });

    expect(await screen.findByRole("heading", { name: "Playable Movie" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收藏" }));
    await user.click(screen.getByRole("button", { name: "播放 Playable Movie" }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent(detailRoutePath("source-b", "video-2"));
    expect(screen.getByLabelText("Navigation state")).toHaveTextContent("source-b");
    expect(window.localStorage.getItem(sourceBundleStorageKey)).toContain("source-b");
    expect(store.get("favorite", "Playable Movie")).not.toBeNull();
  });

  it("opens the fastest source by default", async () => {
    const user = userEvent.setup();
    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({ type: "result", response: { results: [result("Fastest Movie")] } });
      },
    });

    expect(await screen.findByRole("heading", { name: "Fastest Movie" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "播放 Fastest Movie" }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent(detailRoutePath("source-b", "video-2"));
  });

  it("navigates playable results when later source entries are malformed", async () => {
    const user = userEvent.setup();
    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({
          type: "result",
          response: {
            results: [
              {
                title: "Partially Unsafe Movie",
                year: "2026",
                sources: [
                  { source_key: "source-a", source_name: "Source A", video_id: "video-1" },
                  null,
                  { source_key: "junk" },
                ],
              },
            ],
          },
        } as unknown as SearchStreamEvent);
      },
    });

    expect(await screen.findByRole("heading", { name: "Partially Unsafe Movie" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "播放 Partially Unsafe Movie" }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent(detailRoutePath("source-a", "video-1"));
    expect(window.localStorage.getItem(sourceBundleStorageKey)).toContain("source-a");
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("junk");
  });

  it("filters out empty-id and separator-bearing source entries so navigation can never hit a dead /detail/:token URL", async () => {
    const user = userEvent.setup();
    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({
          type: "result",
          response: {
            results: [
              {
                title: "Mixed Garbage Movie",
                year: "2026",
                sources: [
                  { source_key: "", source_name: "Empty Key", video_id: "video-1" },
                  { source_key: "source-a", source_name: "Empty ID", video_id: "" },
                  { source_key: "bad\x1Fsource", source_name: "Sep In Key", video_id: "video-1" },
                  { source_key: "source-a", source_name: "Sep In ID", video_id: "bad\x1Fvideo" },
                  { source_key: "source-good", source_name: "Source Good", video_id: "video-good" },
                ],
              },
            ],
          },
        } as unknown as SearchStreamEvent);
      },
    });

    expect(await screen.findByRole("heading", { name: "Mixed Garbage Movie" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "播放 Mixed Garbage Movie" }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent(detailRoutePath("source-good", "video-good"));
    const stored = window.localStorage.getItem(sourceBundleStorageKey) ?? "";
    expect(stored).toContain("source-good");
    expect(stored).not.toContain("Empty Key");
    expect(stored).not.toContain("Empty ID");
    expect(stored).not.toContain("Sep In Key");
    expect(stored).not.toContain("Sep In ID");
  });

  it("renders existing favorites by title and toggles them through the sync store", async () => {
    const user = userEvent.setup();
    const item = result("Saved Movie");
    const store = openSyncStore(0, "");
    store.upsert("favorite", { ...favoriteFromSearchResult(item), source_key: "old-source", video_id: "old-id" });
    renderSearch({
      store,
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({ type: "result", response: { results: [item] } });
      },
    });

    expect(await screen.findByRole("button", { name: "取消收藏" })).toHaveClass("ui-button-danger");
    await user.click(screen.getByRole("button", { name: "取消收藏" }));
    expect(await screen.findByRole("button", { name: "收藏" })).toBeInTheDocument();
    expect(store.get("favorite", "saved movie")).toBeNull();
  });

  it("records submitted queries and shows recent searches before a query is active", async () => {
    const user = userEvent.setup();
    const store = openSyncStore(0, "");
    store.upsert("search", { query: "Older Query" });
    renderSearch({ store, initialEntry: "/search" });

    expect(screen.getByRole("region", { name: "最近搜索" })).toBeInTheDocument();
    await user.type(screen.getByRole("textbox", { name: "搜索关键词" }), "  New Query ");
    await user.click(screen.getByRole("button", { name: "搜索" }));

    await waitFor(() => expect(store.list("search").map((r) => r.payload.query)).toEqual(["New Query", "Older Query"]));
    expect(screen.queryByRole("region", { name: "最近搜索" })).toBeNull();
  });

  it("does not record a search opened from a link or a reload", async () => {
    const store = openSyncStore(0, "");
    renderSearch({ store, initialEntry: "/search?q=Linked%20Title" });
    expect(await screen.findByRole("heading", { name: "Movie" })).toBeInTheDocument();
    expect(store.list("search")).toEqual([]);
  });

  it("searches again and moves the query to the top when a recent search chip is clicked", async () => {
    const user = userEvent.setup();
    let now = 1_790_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
    const store = openSyncStore(0, "");
    store.upsert("search", { query: "Chip Query" });
    store.upsert("search", { query: "Newer Query" });
    const searchStream = vi.fn<TestSearchStream>(async () => undefined);
    renderSearch({ store, initialEntry: "/search", searchStream });

    await user.click(screen.getByRole("button", { name: "Chip Query" }));
    await waitFor(() => expect(searchStream).toHaveBeenCalled());
    expect(searchStream.mock.calls[0]![0]).toBe("Chip Query");
    expect(store.list("search")[0]?.payload.query).toBe("Chip Query");
  });

  it("clears recent searches through the sync store", async () => {
    const user = userEvent.setup();
    const store = openSyncStore(0, "");
    store.upsert("search", { query: "Forget Me" });
    renderSearch({ store, initialEntry: "/search" });

    await user.click(within(screen.getByRole("region", { name: "最近搜索" })).getByRole("button", { name: "清空" }));
    expect(screen.queryByRole("region", { name: "最近搜索" })).toBeNull();
    expect(store.state().pendingClears.search).toBeGreaterThan(0);
  });

  it("preserves an active SSE across route navigation and resumes display on return", async () => {
    const user = userEvent.setup();
    let onEventCapture: ((event: SearchStreamEvent) => void) | undefined;
    // searchStream hangs until the test fires a result manually.
    // searchStream
    //
    // 挂起直到测试手动触发结果.
    const searchStream = vi.fn(async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
      onEventCapture = onEvent;
      onEvent({ type: "progress", progress: { phase: "searching", completed: 4, total: 10 } });
      await new Promise<void>(() => undefined);
    });

    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const api = createTestAPI({ searchStream });

    function FavoritesStub() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/search?q=Movie")}>
          Back to search
        </button>
      );
    }

    function SearchNavBar() {
      const navigate = useNavigate();
      return (
        <button type="button" onClick={() => navigate("/favorites")}>
          Go to favorites
        </button>
      );
    }

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={queryClient}>
          <MemoryRouter initialEntries={["/search?q=Movie"]}>
            <SearchNavBar />
            <Routes>
              <Route path="/search" element={<SearchPage />} />
              <Route path="/favorites" element={<FavoritesStub />} />
            </Routes>
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    expect(await screen.findByText("4 / 10")).toBeInTheDocument();
    const controller = searchStore.getState().activeController;
    expect(controller).not.toBeNull();
    expect(searchStream).toHaveBeenCalledTimes(1);

    // Navigate away mid-search.
    //
    // 中途离开页面.
    await user.click(screen.getByRole("button", { name: "Go to favorites" }));
    expect(screen.queryByText("4 / 10")).toBeNull();
    expect(controller?.signal.aborted).toBe(false);

    // Navigate back;
    // previous SSE is still running, no new stream is started.
    //
    // 返回页面, 原 SSE 仍在跑, 不会启动新流.
    await user.click(screen.getByRole("button", { name: "Back to search" }));
    expect(await screen.findByText("4 / 10")).toBeInTheDocument();
    expect(searchStream).toHaveBeenCalledTimes(1);

    // The still-running stream can deliver a result and the UI picks it up.
    //
    // 仍在运行的流可以送出结果, UI 会显示.
    act(() => onEventCapture?.({ type: "result", response: { results: [result("Returned Movie")] } }));
    expect(await screen.findByRole("heading", { name: "Returned Movie" })).toBeInTheDocument();
  });
});
