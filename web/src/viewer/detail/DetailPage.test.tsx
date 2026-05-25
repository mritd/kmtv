import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SearchResult } from "@/api/types";
import { APIProvider } from "@/api/context";
import { detailRoutePath } from "@/storage/detailRoute";
import { bundleFromSearchResult, restoreSourceBundle, saveSourceBundle, sourceBundleStorageKey, upsertSourceBundleDetail } from "@/storage/sourceBundles";
import { createTestAPI } from "@/test/testAPI";

import { DetailPage } from "./DetailPage";
import { SourcePicker } from "./SourcePicker";

const DETAIL_A = detailRoutePath("source-a", "video-a");
const DETAIL_C = detailRoutePath("source-c", "video-c");

const multiSourceResult: SearchResult = {
  title: "Demo Show",
  type: "Drama",
  year: "2026",
  sources: [
    {
      source_key: "source-a",
      source_name: "Source A",
      video_id: "video-a",
      duration_ms: 1200,
    },
    {
      source_key: "source-b",
      source_name: "Source B",
      video_id: "video-b",
      duration_ms: 450,
      episodes: [
        { name: "01", url: "https://search-b.example/1.m3u8" },
        { name: "02", url: "https://search-b.example/2.m3u8" },
      ],
    },
  ],
};

const threeSourceResult: SearchResult = {
  ...multiSourceResult,
  sources: [
    multiSourceResult.sources[0],
    multiSourceResult.sources[1],
    {
      source_key: "source-c",
      source_name: "Source C",
      video_id: "video-c",
      episodes: [{ name: "01", url: "https://search-c.example/1.m3u8" }],
    },
  ],
};

type DetailEntry = string | { pathname: string; state?: unknown };

function renderDetail(api = createTestAPI(), initialEntry: DetailEntry = DETAIL_A) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <APIProvider value={api}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialEntry]}>
          <Routes>
            <Route path="/detail/:token" element={<DetailPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </APIProvider>,
  );
}

function RouteChangeHarness() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(DETAIL_C)}>
        Navigate to Source C
      </button>
      <Routes>
        <Route path="/detail/:token" element={<DetailPage />} />
      </Routes>
    </>
  );
}

function SameRouteStateHarness({ sourceBundle }: { sourceBundle: ReturnType<typeof bundleFromSearchResult> }) {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate(DETAIL_A, { state: { sourceBundle } })}>
        Navigate to Same Route With State
      </button>
      <Routes>
        <Route path="/detail/:token" element={<DetailPage />} />
      </Routes>
    </>
  );
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function upsertReadySourceA(bundle: ReturnType<typeof bundleFromSearchResult>) {
  return upsertSourceBundleDetail(bundle, "source-a", "video-a", {
    id: "video-a",
    title: "Demo Show",
    episodes: [[{ name: "01", url: "https://cached-source-a.example/1.m3u8" }]],
  });
}

describe("DetailPage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("renders the invalid-token status when the route token cannot be decoded", () => {
    renderDetail(createTestAPI(), "/detail/0OIl-invalid");

    expect(screen.getByRole("heading", { name: "详情加载失败" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "返回搜索" })).toHaveAttribute("href", "/search");
  });

  it("renders video source items with status labels", () => {
    render(
      <SourcePicker
        sources={[
          { key: "source-a", name: "Source A", durationMs: 450, status: "ready" },
          { key: "source-b", name: "Source B", durationMs: 1200, status: "loading" },
          { key: "source-c", name: "Source C", durationMs: 3600, status: "failed" },
          { key: "source-d", name: "Source D", status: "idle" },
        ]}
        selectedKey="source-a"
        onSelect={() => undefined}
      />,
    );

    expect(screen.getByRole("heading", { name: "视频源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source A · 450ms" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Source A · 450ms" })).toHaveClass("source-button", "active");
    expect(screen.getByText("450ms")).toHaveClass("source-latency-good");
    expect(screen.getByRole("button", { name: "Source B · 1.2s" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("1.2s")).toHaveClass("source-latency-warn");
    expect(screen.getByRole("button", { name: "Source C · 3.6s" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("3.6s")).toHaveClass("source-latency-bad");
    expect(screen.getByRole("button", { name: "Source D · 未知" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByText("未知")).toHaveClass("source-latency-unknown");
  });

  it("collapses source items after the first eight and can expand them", async () => {
    const user = userEvent.setup();
    const sources = Array.from({ length: 10 }, (_, index) => ({
      key: `source-${index + 1}`,
      name: `Source ${index + 1}`,
      durationMs: 500 + index,
      status: "ready" as const,
    }));

    render(<SourcePicker sources={sources} selectedKey="source-1" onSelect={() => undefined} />);

    expect(screen.getByRole("button", { name: "Source 8 · 507ms" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Source 9 · 508ms" })).toBeNull();
    expect(screen.getByRole("button", { name: "显示更多" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "显示更多" }));

    expect(screen.getByRole("button", { name: "Source 9 · 508ms" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "收起" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "收起" }));

    expect(screen.queryByRole("button", { name: "Source 9 · 508ms" })).toBeNull();
  });

  it("resolves playback URL after selecting an episode", async () => {
    const user = userEvent.setup();
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        area: "CN",
        episodes: [[{ name: "01", url: "https://cdn.example/1.m3u8" }, { name: "02", url: "https://cdn.example/2.m3u8" }]],
      })),
      playbackURL: vi.fn(async () => ({ mode: "proxy" as const, url: "https://proxy.example/1.m3u8" })),
    });
    renderDetail(api);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn.example/1.m3u8", "source-a"));

    await user.click(await screen.findByRole("button", { name: "播放 02" }));

    expect(api.playbackURL).toHaveBeenCalledWith("https://cdn.example/2.m3u8", "source-a");
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    expect(screen.queryByText("播放地址已就绪")).toBeNull();
  });

  it("auto resolves the first episode in a single source", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        area: "CN",
        episodes: [
          [
            { name: "01", url: "https://cdn.example/1.m3u8" },
            { name: "02", url: "https://cdn.example/2.m3u8" },
          ],
        ],
      })),
      playbackURL: vi.fn(async () => ({ mode: "proxy" as const, url: "https://proxy.example/1.m3u8" })),
    });

    renderDetail(api);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn.example/1.m3u8", "source-a"));
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    expect(screen.queryByText("播放地址已就绪")).toBeNull();
  });

  it("auto resolves the first playable episode group when the first group is empty", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        area: "CN",
        episodes: [[], [{ name: "01", url: "https://cdn-b.example/1.m3u8" }]],
      })),
      playbackURL: vi.fn(async () => ({ mode: "proxy" as const, url: "https://proxy.example/1.m3u8" })),
    });

    renderDetail(api);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-b.example/1.m3u8", "source-a"));
  });

  it("keeps selected episode visible when playback resolution fails", async () => {
    const user = userEvent.setup();
    const api = createTestAPI({
      detail: async () => ({
        id: "video-a",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn.example/1.m3u8" }, { name: "02", url: "https://cdn.example/2.m3u8" }]],
      }),
      playbackURL: async () => {
        throw new Error("network down");
      },
    });

    renderDetail(api);

    await user.click(await screen.findByRole("button", { name: "播放 01" }));

    expect(await screen.findByText("播放地址解析失败")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试 01" })).toBeInTheDocument();
  });

  it("shows video sources from navigation state", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    expect(await screen.findByRole("heading", { name: "视频源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source A · 1.2s" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Source B/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("restores video sources from localStorage when navigation state is absent", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });
    saveSourceBundle(bundleFromSearchResult(multiSourceResult));

    renderDetail(api, DETAIL_A);

    expect(await screen.findByRole("heading", { name: "视频源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source A · 1.2s" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Source B/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("loads the shared URL source first and restores other sources through background search", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        episodes: [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]],
      })),
      search: vi.fn(async () => ({ results: [multiSourceResult] })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, DETAIL_A);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-a.example/1.m3u8", "source-a"));
    expect(api.playbackURL).toHaveBeenNthCalledWith(1, "https://cdn-a.example/1.m3u8", "source-a");
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("Demo Show"));
    expect(await screen.findByRole("button", { name: /Source B/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps the shared URL source when recovery finds the same media without the route source", async () => {
    const recoveredResult: SearchResult = {
      ...multiSourceResult,
      sources: [multiSourceResult.sources[1]],
    };
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
      })),
      search: vi.fn(async () => ({ results: [recoveredResult] })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, DETAIL_A);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("Demo Show"));
    expect(screen.getByRole("button", { name: "source-a · 未知" })).toHaveAttribute("aria-pressed", "true");
    expect(await screen.findByRole("button", { name: /Source B/ })).toHaveAttribute("aria-pressed", "false");
    expect(api.playbackURL).toHaveBeenNthCalledWith(1, "https://cdn-source-a.example/1.m3u8", "source-a");
  });

  it("skips malformed shared URL recovery results before a valid match", async () => {
    const validResult: SearchResult = {
      ...multiSourceResult,
      sources: [multiSourceResult.sources[0], multiSourceResult.sources[1]],
    };
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
      })),
      search: vi.fn(async () => ({
        results: [null, { title: "Demo Show", sources: null }, { title: 12, sources: [] }, validResult] as unknown as SearchResult[],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, DETAIL_A);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("Demo Show"));
    expect(await screen.findByRole("button", { name: /Source B/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("keeps shared URL playback working in single-source mode when recovery has no match", async () => {
    const user = userEvent.setup();
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        episodes: [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]],
      })),
      search: vi.fn(async () => ({ results: [{ ...multiSourceResult, title: "Other Show" }] })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, DETAIL_A);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-a.example/1.m3u8", "source-a"));
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("Demo Show"));
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "播放 01" }));
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Source B/ })).toBeNull();
    expect(screen.queryByText("详情加载失败")).toBeNull();
  });

  it("keeps shared URL playback working in single-source mode when recovery search fails", async () => {
    const user = userEvent.setup();
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        type: "Drama",
        year: "2026",
        episodes: [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]],
      })),
      search: vi.fn(async () => {
        throw new Error("search failed");
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, DETAIL_A);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-a.example/1.m3u8", "source-a"));
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("Demo Show"));
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "播放 01" }));
    expect(api.search).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: /Source B/ })).toBeNull();
    expect(screen.queryByText("详情加载失败")).toBeNull();
    expect(screen.queryByText("没有详情数据")).toBeNull();
    expect(screen.queryByText("播放地址解析失败")).toBeNull();
  });

  it("ignores stale shared URL recovery after the same route receives a state bundle", async () => {
    const staleSearch = deferred<{ results: SearchResult[] }>();
    const stateResult: SearchResult = {
      ...multiSourceResult,
      sources: [
        multiSourceResult.sources[0],
        {
          source_key: "source-c",
          source_name: "Source C",
          video_id: "video-c",
          episodes: [{ name: "01", url: "https://search-c.example/1.m3u8" }],
        },
      ],
    };
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
      })),
      search: vi.fn(() => staleSearch.promise),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[DETAIL_A]}>
            <SameRouteStateHarness sourceBundle={bundleFromSearchResult(stateResult)} />
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    await waitFor(() => expect(api.search).toHaveBeenCalledWith("Demo Show"));
    await userEvent.click(screen.getByRole("button", { name: "Navigate to Same Route With State" }));
    expect(await screen.findByRole("button", { name: /Source C/ })).toBeInTheDocument();

    await act(async () => {
      staleSearch.resolve({ results: [multiSourceResult] });
      await staleSearch.promise;
    });

    expect(screen.getByRole("button", { name: /Source C/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Source B/ })).toBeNull();
  });

  it("keeps current playback working when background detail loading fails", async () => {
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => {
        if (source === "source-b") {
          throw new Error("background failed");
        }
        return {
          id,
          title: "Demo Show",
          episodes: [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]],
        };
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Source B · 450ms" })).toBeInTheDocument());
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    expect(screen.queryByText("详情加载失败")).toBeNull();
  });

  it("does not persist selected source detail failure payloads", async () => {
    const background = deferred<never>();
    const api = createTestAPI({
      detail: vi.fn((source) => {
        if (source === "source-a") {
          return Promise.reject(new Error("current failed"));
        }
        return background.promise;
      }),
    });
    const bundle = bundleFromSearchResult(multiSourceResult);
    saveSourceBundle(bundle);

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundle } });

    await waitFor(() => expect(screen.getByRole("button", { name: "Source A · 1.2s" })).toBeInTheDocument());
    expect(restoreSourceBundle("source-a", "video-a")?.details).toEqual({});
  });

  it("loads background source detail without persisting episode URLs", async () => {
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    expect(restoreSourceBundle("source-b", "video-b")?.details).toEqual({});
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-b.example/1.m3u8");
  });

  it("keeps pending background detail in memory after current detail updates the bundle", async () => {
    const current = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const background = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-a") {
          return current.promise;
        }
        return background.promise.then(() => ({
          id,
          title: "Demo Show",
          episodes: [[{ name: "01", url: "https://cdn-source-b.example/1.m3u8" }]],
        }));
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    current.resolve({
      id: "video-a",
      title: "Demo Show",
      episodes: [[{ name: "01", url: "https://cdn-source-a.example/1.m3u8" }]],
    });
    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));

    background.resolve({ id: "video-b", title: "Demo Show", episodes: [] });

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    expect(restoreSourceBundle("source-b", "video-b")?.details).toEqual({});
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-b.example/1.m3u8");
  });

  it("keeps every pending background source isolated when one completes first", async () => {
    const sourceB = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const sourceC = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          return sourceB.promise.then(() => ({
            id,
            title: "Demo Show",
            episodes: [[{ name: "01", url: "https://cdn-source-b.example/1.m3u8" }]],
          }));
        }
        if (source === "source-c") {
          return sourceC.promise.then(() => ({
            id,
            title: "Demo Show",
            episodes: [[{ name: "01", url: "https://cdn-source-c.example/1.m3u8" }]],
          }));
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [[{ name: "01", url: "https://cdn-source-a.example/1.m3u8" }]],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(threeSourceResult) } });

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-c", "video-c"));
    sourceB.resolve({ id: "video-b", title: "Demo Show", episodes: [] });
    await waitFor(() => expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-b.example/1.m3u8"));

    sourceC.resolve({ id: "video-c", title: "Demo Show", episodes: [] });

    expect(restoreSourceBundle("source-c", "video-c")?.details).toEqual({});
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-c.example/1.m3u8");
  });

  it("restores source list without cached episode details when refresh detail request fails", async () => {
    const readyBundle = upsertReadySourceA(bundleFromSearchResult(multiSourceResult));
    saveSourceBundle(readyBundle);
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-a") {
          return Promise.reject(new Error("refresh failed"));
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [[{ name: "01", url: "https://cdn-source-b.example/1.m3u8" }]],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, DETAIL_A);

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-a", "video-a"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Source A · 1.2s" })).toHaveAttribute("aria-pressed", "true"));
    expect(restoreSourceBundle("source-a", "video-a")?.details).toEqual({});
  });

  it("does not write stale background detail after the route bundle changes", async () => {
    const user = userEvent.setup();
    const staleBackground = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          return staleBackground.promise.then(() => ({
            id,
            title: "Demo Show",
            episodes: [[{ name: "01", url: "https://cdn-stale-b.example/1.m3u8" }]],
          }));
        }
        return Promise.resolve({
          id,
          title: source === "source-c" ? "Route C Show" : "Demo Show",
          episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } }]}>
            <RouteChangeHarness />
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    await user.click(screen.getByRole("button", { name: "Navigate to Source C" }));
    await screen.findByText("Route C Show");
    staleBackground.resolve({ id: "video-b", title: "Demo Show", episodes: [] });

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-c", "video-c"));
    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-stale-b.example/1.m3u8");
  });

  it("starts background detail again when the same route receives a new bundle with an overlapping source", async () => {
    const user = userEvent.setup();
    const staleBackground = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    let sourceBCalls = 0;
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          sourceBCalls += 1;
          if (sourceBCalls === 1) {
            return staleBackground.promise;
          }
          return Promise.resolve({
            id,
            title: "Demo Show",
            episodes: [[{ name: "01", url: "https://cdn-source-b-fresh.example/1.m3u8" }]],
          });
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [[{ name: "01", url: "https://cdn-source-a.example/1.m3u8" }]],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const nextBundle = bundleFromSearchResult(multiSourceResult);

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } }]}>
            <SameRouteStateHarness sourceBundle={nextBundle} />
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    await waitFor(() => expect(sourceBCalls).toBe(1));
    await user.click(screen.getByRole("button", { name: "Navigate to Same Route With State" }));

    await waitFor(() => expect(sourceBCalls).toBe(2));
    await waitFor(() => expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-b-fresh.example/1.m3u8"));
  });

  it("ignores stale background detail when an older overlapping request completes before the fresh one", async () => {
    const user = userEvent.setup();
    const staleBackground = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const freshBackground = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    let sourceBCalls = 0;
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          sourceBCalls += 1;
          return sourceBCalls === 1 ? staleBackground.promise : freshBackground.promise;
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [[{ name: "01", url: "https://cdn-source-a.example/1.m3u8" }]],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } }]}>
            <SameRouteStateHarness sourceBundle={bundleFromSearchResult(multiSourceResult)} />
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    await waitFor(() => expect(sourceBCalls).toBe(1));
    await user.click(screen.getByRole("button", { name: "Navigate to Same Route With State" }));
    await waitFor(() => expect(sourceBCalls).toBe(2));

    await act(async () => {
      staleBackground.resolve({
        id: "video-b",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn-source-b-stale.example/1.m3u8" }]],
      });
      await staleBackground.promise;
    });

    expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-b-stale.example/1.m3u8");

    await act(async () => {
      freshBackground.resolve({
        id: "video-b",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn-source-b-fresh.example/1.m3u8" }]],
      });
      await freshBackground.promise;
    });

    await waitFor(() => expect(window.localStorage.getItem(sourceBundleStorageKey)).not.toContain("https://cdn-source-b-fresh.example/1.m3u8"));
  });

  it("preserves selected episode index when switching sources", async () => {
    const user = userEvent.setup();
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        episodes: [
          [
            { name: "01", url: `https://cdn-${source}.example/1.m3u8` },
            { name: "02", url: `https://cdn-${source}.example/2.m3u8` },
          ],
        ],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await user.click(await screen.findByRole("button", { name: "播放 02" }));
    await user.click(screen.getByRole("button", { name: "Source B · 450ms" }));

    await waitFor(() => expect(api.detail).toHaveBeenCalledWith("source-b", "video-b"));
    expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-b.example/2.m3u8", "source-b");
  });

  it("preserves selected episode index when switched source detail loads later", async () => {
    const user = userEvent.setup();
    const sourceBDetail = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const result: SearchResult = {
      ...multiSourceResult,
      sources: [
        multiSourceResult.sources[0],
        {
          source_key: "source-b",
          source_name: "Source B",
          video_id: "video-b",
          episodes: [],
        },
      ],
    };
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          return sourceBDetail.promise;
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [
            [
              { name: "01", url: "https://cdn-source-a.example/1.m3u8" },
              { name: "02", url: "https://cdn-source-a.example/2.m3u8" },
            ],
          ],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(result) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await user.click(await screen.findByRole("button", { name: "播放 02" }));
    await user.click(screen.getByRole("button", { name: "Source B · 未知" }));

    await act(async () => {
      sourceBDetail.resolve({
        id: "video-b",
        title: "Demo Show",
        episodes: [
          [
            { name: "01", url: "https://cdn-source-b.example/1.m3u8" },
            { name: "02", url: "https://cdn-source-b.example/2.m3u8" },
          ],
        ],
      });
      await sourceBDetail.promise;
    });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-b.example/2.m3u8", "source-b"));
    expect(api.playbackURL).not.toHaveBeenCalledWith("https://cdn-source-b.example/1.m3u8", "source-b");
  });

  it("preserves selected episode index after partial source fallback resolves first", async () => {
    const user = userEvent.setup();
    const sourceBDetail = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const result: SearchResult = {
      ...multiSourceResult,
      sources: [
        multiSourceResult.sources[0],
        {
          source_key: "source-b",
          source_name: "Source B",
          video_id: "video-b",
          episodes: [{ name: "01", url: "https://search-source-b.example/1.m3u8" }],
        },
      ],
    };
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          return sourceBDetail.promise;
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [
            [
              { name: "01", url: "https://cdn-source-a.example/1.m3u8" },
              { name: "02", url: "https://cdn-source-a.example/2.m3u8" },
            ],
          ],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(result) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await user.click(await screen.findByRole("button", { name: "播放 02" }));
    await user.click(screen.getByRole("button", { name: "Source B · 未知" }));
    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://search-source-b.example/1.m3u8", "source-b"));

    await act(async () => {
      sourceBDetail.resolve({
        id: "video-b",
        title: "Demo Show",
        episodes: [
          [
            { name: "01", url: "https://cdn-source-b.example/1.m3u8" },
            { name: "02", url: "https://cdn-source-b.example/2.m3u8" },
          ],
        ],
      });
      await sourceBDetail.promise;
    });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-b.example/2.m3u8", "source-b"));
  });

  it("keeps manually selected fallback episode when delayed source detail arrives", async () => {
    const user = userEvent.setup();
    const sourceBDetail = deferred<{ id: string; title: string; episodes: { name: string; url: string }[][] }>();
    const result: SearchResult = {
      ...multiSourceResult,
      sources: [
        multiSourceResult.sources[0],
        {
          source_key: "source-b",
          source_name: "Source B",
          video_id: "video-b",
          episodes: [{ name: "01", url: "https://search-source-b.example/1.m3u8" }],
        },
      ],
    };
    const api = createTestAPI({
      detail: vi.fn((source, id) => {
        if (source === "source-b") {
          return sourceBDetail.promise;
        }
        return Promise.resolve({
          id,
          title: "Demo Show",
          episodes: [
            [
              { name: "01", url: "https://cdn-source-a.example/1.m3u8" },
              { name: "02", url: "https://cdn-source-a.example/2.m3u8" },
            ],
          ],
        });
      }),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(result) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await user.click(await screen.findByRole("button", { name: "播放 02" }));
    await user.click(screen.getByRole("button", { name: "Source B · 未知" }));
    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://search-source-b.example/1.m3u8", "source-b"));
    await user.click(screen.getByRole("button", { name: "播放 01" }));

    await act(async () => {
      sourceBDetail.resolve({
        id: "video-b",
        title: "Demo Show",
        episodes: [
          [
            { name: "01", url: "https://cdn-source-b.example/1.m3u8" },
            { name: "02", url: "https://cdn-source-b.example/2.m3u8" },
          ],
        ],
      });
      await sourceBDetail.promise;
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "播放 01" })).toHaveClass("active"));
    expect(api.playbackURL).not.toHaveBeenCalledWith("https://cdn-source-b.example/2.m3u8", "source-b");
  });

  it("falls back to first episode when the next source has fewer episodes", async () => {
    const user = userEvent.setup();
    const result: SearchResult = {
      ...multiSourceResult,
      sources: [
        multiSourceResult.sources[0],
        {
          source_key: "source-b",
          source_name: "Source B",
          video_id: "video-b",
          episodes: [{ name: "01", url: "https://search-b.example/1.m3u8" }],
        },
      ],
    };
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        episodes:
          source === "source-a"
            ? [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }, { name: "02", url: "https://cdn-a.example/2.m3u8" }]]
            : [[{ name: "01", url: "https://cdn-b.example/1.m3u8" }]],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(result) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-a.example/1.m3u8", "source-a"));
    await user.click(await screen.findByRole("button", { name: "播放 02" }));
    await user.click(screen.getByRole("button", { name: "Source B · 未知" }));

    expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-b.example/1.m3u8", "source-b");
  });

  it("resets detail state when the route changes", async () => {
    const user = userEvent.setup();
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: source === "source-c" ? "Route C Show" : "Route A Show",
        episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
      })),
      playbackURL: vi.fn(async (url) => ({ mode: "proxy" as const, url })),
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[{ pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } }]}>
            <RouteChangeHarness />
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    expect(await screen.findByText("Route A Show")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Navigate to Source C" }));

    expect(await screen.findByText("Route C Show")).toBeInTheDocument();
    expect(api.detail).toHaveBeenCalledWith("source-c", "video-c");
    expect(screen.queryByRole("button", { name: /Source B/ })).toBeNull();
  });

  it("ignores stale playback failures after selecting a newer episode", async () => {
    const user = userEvent.setup();
    const first = deferred<{ mode: "proxy"; url: string }>();
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn.example/1.m3u8" }, { name: "02", url: "https://cdn.example/2.m3u8" }]],
      })),
      playbackURL: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({ mode: "proxy" as const, url: "https://proxy.example/2.m3u8" }),
    });

    renderDetail(api);

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn.example/1.m3u8", "source-a"));
    await user.click(await screen.findByRole("button", { name: "播放 02" }));
    await screen.findByLabelText("ArtPlayer 播放器");
    first.reject(new Error("late failure"));

    await waitFor(() => expect(screen.queryByText("播放地址解析失败")).toBeNull());
    expect(screen.getByText("02")).toBeInTheDocument();
  });

  it("ignores stale playback failures after switching sources", async () => {
    const user = userEvent.setup();
    const first = deferred<{ mode: "proxy"; url: string }>();
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        episodes: [[{ name: "01", url: `https://cdn-${source}.example/1.m3u8` }]],
      })),
      playbackURL: vi
        .fn()
        .mockImplementationOnce(() => first.promise)
        .mockResolvedValueOnce({ mode: "proxy" as const, url: "https://proxy-b.example/1.m3u8" }),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-source-a.example/1.m3u8", "source-a"));
    await user.click(screen.getByRole("button", { name: "Source B · 450ms" }));
    await screen.findByLabelText("ArtPlayer 播放器");
    first.reject(new Error("late failure"));

    await waitFor(() => expect(screen.queryByText("播放地址解析失败")).toBeNull());
    expect(screen.getByRole("button", { name: "Source B · 450ms" })).toHaveAttribute("aria-pressed", "true");
  });

  it("ignores stale playback success after switching to a source without immediate episodes", async () => {
    const user = userEvent.setup();
    const first = deferred<{ mode: "proxy"; url: string }>();
    const result: SearchResult = {
      ...multiSourceResult,
      sources: [
        {
          source_key: "source-a",
          source_name: "Source A",
          video_id: "video-a",
        },
        {
          source_key: "source-empty",
          source_name: "Source Empty",
          video_id: "video-empty",
        },
      ],
    };
    const api = createTestAPI({
      detail: vi.fn(async (source, id) => ({
        id,
        title: "Demo Show",
        episodes: source === "source-a" ? [[{ name: "01", url: "https://cdn-a.example/1.m3u8" }]] : [],
      })),
      playbackURL: vi.fn(() => first.promise),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(result) } });

    await waitFor(() => expect(api.playbackURL).toHaveBeenCalledWith("https://cdn-a.example/1.m3u8", "source-a"));
    await user.click(screen.getByRole("button", { name: "Source Empty · 未知" }));
    first.resolve({ mode: "proxy", url: "https://proxy-a.example/1.m3u8" });

    await waitFor(() => expect(screen.getByRole("button", { name: "Source Empty · 未知" })).toHaveAttribute("aria-pressed", "true"));
    expect(screen.queryByLabelText("ArtPlayer 播放器")).toBeNull();
    expect(screen.queryByText("播放地址解析失败")).toBeNull();
  });

  it("keeps source picker visible when selected source detail fails in a multi-source bundle", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => {
        throw new Error("detail failed");
      }),
    });

    renderDetail(api, { pathname: DETAIL_A, state: { sourceBundle: bundleFromSearchResult(multiSourceResult) } });

    expect(await screen.findByRole("heading", { name: "视频源" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Source B · 450ms" })).toBeInTheDocument();
    expect(screen.queryByText("详情加载失败")).toBeNull();
  });

  it("restores playback state when navigating away and back to the same detail route", async () => {
    const user = userEvent.setup();
    const playbackURL = vi.fn(async () => ({ mode: "proxy" as const, url: "https://proxy.example/1.m3u8" }));
    const api = createTestAPI({
      detail: vi.fn(async () => ({
        id: "video-a",
        title: "Demo Show",
        episodes: [[{ name: "01", url: "https://cdn.example/1.m3u8" }]],
      })),
      playbackURL,
    });

    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });

    function NavHarness() {
      const navigate = useNavigate();
      return (
        <>
          <button type="button" onClick={() => navigate("/search")}>Go to search</button>
          <button type="button" onClick={() => navigate(DETAIL_A)}>Back to detail</button>
          <Routes>
            <Route path="/detail/:token" element={<DetailPage />} />
            <Route path="/search" element={<div>Search stub</div>} />
          </Routes>
        </>
      );
    }

    render(
      <APIProvider value={api}>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[DETAIL_A]}>
            <NavHarness />
          </MemoryRouter>
        </QueryClientProvider>
      </APIProvider>,
    );

    // Wait for playback URL resolution.
    // 等待播放 URL 解析完成.
    await waitFor(() => expect(playbackURL).toHaveBeenCalledTimes(1));
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();

    // Navigate away to /search.
    // 离开页面到 /search.
    await user.click(screen.getByRole("button", { name: "Go to search" }));
    expect(screen.getByText("Search stub")).toBeInTheDocument();

    // Navigate back to the same detail route.
    // 返回同一详情路由.
    await user.click(screen.getByRole("button", { name: "Back to detail" }));

    // Playback panel is restored from detailStore cache;
    // playbackURL was NOT called again.
    // 播放器从 detailStore 缓存恢复, 未再次调用 playbackURL.
    expect(await screen.findByLabelText("ArtPlayer 播放器")).toBeInTheDocument();
    expect(playbackURL).toHaveBeenCalledTimes(1);
  });

  it("renders the loading skeleton while the initial detail fetch is in-flight", () => {
    // Hold the detail promise open so the page stays in the loading state.
    // 保持 detail promise 未完成, 使页面停留在加载状态.
    const api = createTestAPI({
      detail: vi.fn(() => new Promise<never>(() => undefined)),
    });
    renderDetail(api);

    // aria-busy confirms the loading branch renders the skeleton wrapper.
    // aria-busy 确认加载分支渲染了骨架包装器.
    const page = screen.getByRole("main");
    expect(page).toHaveAttribute("aria-busy", "true");
  });

  it("shows the error state when the single-source detail fetch fails", async () => {
    const api = createTestAPI({
      detail: vi.fn(async () => {
        throw new Error("network error");
      }),
      // No-op search so recovery attempt does not affect the assertion timing.
      // 空搜索使恢复尝试不影响断言时机.
      search: vi.fn(() => new Promise<never>(() => undefined)),
    });
    renderDetail(api);

    expect(await screen.findByText("详情加载失败")).toBeInTheDocument();
    expect(screen.queryByRole("main", { hidden: true, name: "加载中" })).toBeNull();
  });

  it("shows the single-source error state when detail fails with no multi-source fallback", async () => {
    // This test covers the branch: detail.isError && !currentDetail && !canRenderRecoverableDetailError
    // (single source bundle → canRenderRecoverableDetailError is false → StatusState shown).
    // 此测试覆盖分支: detail.isError && !currentDetail && !canRenderRecoverableDetailError
    // (单来源 bundle → canRenderRecoverableDetailError 为假 → 显示 StatusState).
    const api = createTestAPI({
      detail: vi.fn(async () => {
        throw new Error("network error");
      }),
      // Keep search pending so it doesn't interfere with the error state rendering.
      // 保持搜索挂起以免干扰错误状态渲染.
      search: vi.fn(() => new Promise<never>(() => undefined)),
    });
    // Single-source route (no bundle in state or localStorage) → canRenderRecoverableDetailError = false.
    // 单来源路由 (state 和 localStorage 中无 bundle) → canRenderRecoverableDetailError = false.
    renderDetail(api);

    expect(await screen.findByText("详情加载失败")).toBeInTheDocument();
    // Source picker is hidden because there is nothing recoverable to switch to.
    // 来源选择器隐藏, 因为没有可切换的恢复来源.
    expect(screen.queryByRole("heading", { name: "视频源" })).toBeNull();
  });
});
