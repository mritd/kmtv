import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { APIClient } from "@/api/client";
import { APIProvider } from "@/api/context";
import type { SearchResult, SearchStreamEvent } from "@/api/types";
import { detailRoutePath } from "@/storage/detailRoute";
import { favoritesKey, makeFavorite } from "@/storage/favorites";
import { sourceBundleStorageKey } from "@/storage/sourceBundles";
import { searchStore } from "@/store/searchStore";
import { createTestAPI } from "@/test/testAPI";

import { SearchPage } from "./SearchPage";

type TestSearchStream = APIClient["searchStream"];

function renderSearch({
  initialEntry = "/search?q=Movie",
  searchStream,
}: {
  initialEntry?: string;
  searchStream?: TestSearchStream;
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
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/search" element={<SearchPage />} />
            <Route path="/detail/:token" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </APIProvider>,
  );

  return api;
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
        // 运行时 payload 可能违反 API 类型, 所以这里直接输入不安全 JSON 形状.
        onEvent({ type: "result", response: { results: null } } as unknown as SearchStreamEvent);
      },
    });

    expect(await screen.findByText("没有搜索结果")).toBeInTheDocument();
  });

  it("treats null streamed source lists as unavailable results", async () => {
    const user = userEvent.setup();
    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        // Runtime payloads can contain null sources from upstream aggregation.
        // 运行时 payload 可能包含上游聚合返回的 null sources.
        onEvent({ type: "result", response: { results: [{ title: "Unsafe Movie", sources: null }] } } as unknown as SearchStreamEvent);
      },
    });

    expect(await screen.findByRole("heading", { name: "Unsafe Movie" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "暂无来源" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "收藏" }));
    expect(window.localStorage.getItem(favoritesKey)).toBeNull();
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
    renderSearch({
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
    expect(window.localStorage.getItem(favoritesKey)).toContain("Playable Movie");
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

  it("renders existing favorites and toggles favorite state immediately", async () => {
    const user = userEvent.setup();
    const item = result("Saved Movie");
    window.localStorage.setItem(favoritesKey, JSON.stringify([makeFavorite(item, item.sources[0])]));

    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({ type: "result", response: { results: [item] } });
      },
    });

    expect(await screen.findByRole("button", { name: "取消收藏" })).toHaveClass("ui-button-danger");

    await user.click(screen.getByRole("button", { name: "取消收藏" }));

    expect(await screen.findByRole("button", { name: "收藏" })).toBeInTheDocument();
    expect(window.localStorage.getItem(favoritesKey)).not.toContain("Saved Movie");
  });

  it("preserves an active SSE across route navigation and resumes display on return", async () => {
    const user = userEvent.setup();
    let onEventCapture: ((event: SearchStreamEvent) => void) | undefined;
    // searchStream hangs until the test fires a result manually.
    // searchStream
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
    // 中途离开页面.
    await user.click(screen.getByRole("button", { name: "Go to favorites" }));
    expect(screen.queryByText("4 / 10")).toBeNull();
    expect(controller?.signal.aborted).toBe(false);

    // Navigate back;
    // previous SSE is still running, no new stream is started.
    // 返回页面, 原 SSE 仍在跑, 不会启动新流.
    await user.click(screen.getByRole("button", { name: "Back to search" }));
    expect(await screen.findByText("4 / 10")).toBeInTheDocument();
    expect(searchStream).toHaveBeenCalledTimes(1);

    // The still-running stream can deliver a result and the UI picks it up.
    // 仍在运行的流可以送出结果, UI 会显示.
    act(() => onEventCapture?.({ type: "result", response: { results: [result("Returned Movie")] } }));
    expect(await screen.findByRole("heading", { name: "Returned Movie" })).toBeInTheDocument();
  });

  it("matches favorites by title and year when the saved source no longer appears", async () => {
    const user = userEvent.setup();
    const item: SearchResult = {
      title: "世界的主人",
      type: "剧情片",
      year: "2025",
      cover: "",
      sources: [{ source_key: "other.example", source_name: "Other Source", video_id: "fresh-89201" }],
    };
    window.localStorage.setItem(
      favoritesKey,
      JSON.stringify([
        {
          title: "世界的主人",
          type: "剧情片",
          year: "2025",
          cover: "https://pic3.yzzyimg.online/upload/vod/2026-04-24/202604241777027916.jpg",
          desc: "珠仁17岁的时光",
          source: { source_key: "1080zyk4.com", source_name: "🎬优质资源", video_id: "89201" },
        },
      ]),
    );

    renderSearch({
      searchStream: async (_query: string, onEvent: (event: SearchStreamEvent) => void) => {
        onEvent({ type: "result", response: { results: [item] } });
      },
    });

    expect(await screen.findByRole("button", { name: "取消收藏" })).toHaveClass("ui-button-danger");

    await user.click(screen.getByRole("button", { name: "取消收藏" }));

    expect(await screen.findByRole("button", { name: "收藏" })).toBeInTheDocument();
    expect(window.localStorage.getItem(favoritesKey)).not.toContain("世界的主人");
  });
});
