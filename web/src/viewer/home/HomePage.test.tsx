/**
 * HomePage.test — integration coverage for recommendations, authenticated history, and home navigation.
 *
 * HomePage.test — 推荐内容, 已认证观看记录和首页导航的集成测试.
 *
 * Responsibilities / 职责:
 *   - Exercise HomePage through real QueryClient, AuthProvider, APIProvider, and router boundaries
 *
 *     — 通过真实 QueryClient, AuthProvider, APIProvider 和 router 边界验证 HomePage
 *
 *   - Guard recommendation, carousel, history, clear, error, and navigation behavior
 *
 *     — 守护推荐, 轮播, 历史, 清空, 错误与导航行为
 *
 * Callers / 调用方:
 *   Vitest test runner — Vitest 测试运行器
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { APIClient } from "@/api/client";
import type { AuthSnapshot, DoubanHomeSection, WatchHistoryItem } from "@/api/types";
import { APIProvider } from "@/api/context";
import { createMemoryTokenStore } from "@/api/tokenStore";
import { AuthProvider } from "@/auth/AuthContext";
import {
  anonymousWatchHistoryKey,
  upsertAnonymousWatchHistory,
} from "@/storage/anonymousWatchHistory";
import { nextWatchHistoryEventTime } from "@/storage/watchHistoryClock";
import { useToastStore } from "@/shared/ui/Toast";
import { createTestAPI } from "@/test/testAPI";

import { HomePage } from "./HomePage";

// LocationDisplay captures the current router location for navigation assertions.
//
// LocationDisplay 捕获当前路由位置以用于导航断言.
function LocationDisplay() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function makeItems(prefix: string, itemCount: number) {
  return Array.from({ length: itemCount }, (_, index) => ({
    id: `${prefix.toLowerCase()}-${index + 1}`,
    title: `${prefix} ${index + 1}`,
    year: "2026",
    cover: "",
    desc: `${prefix} ${index + 1} description`,
  }));
}

function makeHistoryItem(overrides: Partial<WatchHistoryItem> = {}): WatchHistoryItem {
  const index = overrides.id ?? 1;
  return {
    id: index,
    source_key: `source-${index}`,
    video_id: `video-${index}`,
    title: `History Show ${index}`,
    cover: "",
    episode: `Episode ${index}`,
    group_index: 0,
    episode_index: index - 1,
    progress_sec: 180,
    duration_sec: 600,
    completed: false,
    event_time_ms: 1_808_000_000_000 + index,
    created_at: "2026-08-09T00:00:00Z",
    updated_at: "2026-08-09T00:00:00Z",
    ...overrides,
  };
}

function makeAuthSnapshot(userID = 42): AuthSnapshot {
  return {
    accessToken: "test-access-token",
    expiresAt: "2099-01-01T00:00:00Z",
    user: { id: userID, username: "viewer", role: "user" },
  };
}

function renderHome(
  sections: DoubanHomeSection[] = [{ name: "热门电影", items: makeItems("Movie", 18) }],
  options: { apiOverrides?: Partial<APIClient>; authenticated?: boolean } = {},
) {
  const api = createTestAPI({
    doubanHome: async () => ({ sections }),
    ...options.apiOverrides,
  });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tokenStore = createMemoryTokenStore(options.authenticated === false ? null : makeAuthSnapshot());

  const view = render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
          <MemoryRouter initialEntries={["/"]}>
            <LocationDisplay />
            <HomePage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </APIProvider>,
  );
  return { ...view, api, queryClient, tokenStore };
}

// renderHomeError renders HomePage with a doubanHome query that rejects.
//
// renderHomeError 渲染 doubanHome query 会 reject 的 HomePage.
//
// Note: QueryClient default retry is false here, but useDoubanHomeQuery sets retry: 1 internally,
// which overrides the QueryClient default. The error tests use a 5 s waitForElementToBeRemoved
// timeout to accommodate the single retry attempt before the query settles to error state.
//
// 注意: QueryClient 默认 retry 为 false, 但 useDoubanHomeQuery 内部设置了 retry: 1 覆盖默认值.
// error 测试使用 5 秒的 waitForElementToBeRemoved 超时以适应 query 在进入错误状态前的单次重试.
function renderHomeError() {
  const api = createTestAPI({ doubanHome: async () => { throw new Error("network failure"); } });
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const tokenStore = createMemoryTokenStore(makeAuthSnapshot());

  return render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <AuthProvider api={api} tokenStore={tokenStore} queryClient={queryClient}>
          <MemoryRouter initialEntries={["/"]}>
            <LocationDisplay />
            <HomePage />
          </MemoryRouter>
        </AuthProvider>
      </QueryClientProvider>
    </APIProvider>,
  );
}

async function waitForHome() {
  await waitForElementToBeRemoved(() => document.querySelector(".home-skeleton"));
}

afterEach(() => {
  window.localStorage.removeItem(anonymousWatchHistoryKey);
  vi.restoreAllMocks();
  vi.useRealTimers();
  useToastStore.setState({ items: [] });
});

describe("HomePage", () => {
  it("keeps the hero focused on one search action", async () => {
    renderHome();

    await waitForHome();

    expect(screen.getByRole("button", { name: "搜索播放" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "打开搜索" })).toBeNull();
    expect(screen.queryByRole("button", { name: "暂停推荐轮播" })).toBeNull();
    expect(screen.queryByRole("button", { name: "继续推荐轮播" })).toBeNull();
  });

  it("renders all items returned for a home section", async () => {
    renderHome([{ name: "热门电影", items: makeItems("Movie", 18) }]);

    await waitForHome();

    expect(screen.getByText("18 部")).toBeInTheDocument();
    const rail = screen.getByRole("list", { name: "热门电影" });
    expect(within(rail).getByRole("button", { name: /Movie 18/ })).toBeInTheDocument();
  });

  it("shows Douban ratings on home rail posters", async () => {
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Rated Movie", year: "2026", cover: "", rate: "8.7" }] },
    ]);

    await waitForHome();

    const rail = screen.getByRole("list", { name: "热门电影" });
    const card = within(rail).getByRole("button", { name: /Rated Movie/ });
    expect(within(card).getByText("8.7")).toHaveClass("poster-rating-badge");
  });

  it("shows year and Douban rating metadata on the active hero", async () => {
    renderHome([
      {
        name: "热门电影",
        items: [{ id: "movie-1", title: "Hero Rated Movie", year: "2026", cover: "", rate: "9.1", desc: "Hero description" }],
      },
    ]);

    await waitForHome();

    const hero = screen.getByLabelText("首页推荐轮播");
    const metadata = within(hero).getByLabelText("推荐内容信息");
    expect(within(metadata).getByText("热门电影")).toHaveClass("hero-meta-chip");
    expect(within(metadata).getByText("2026")).toHaveClass("hero-meta-chip");
    expect(within(metadata).getByText("豆瓣 9.1")).toHaveClass("hero-meta-chip");
  });

  it("omits unavailable Douban rating metadata on the active hero", async () => {
    const unavailableRatings = [
      { title: "Zero Rated Hero", rate: "0" },
      { title: "Missing Rated Hero" },
    ];

    for (const item of unavailableRatings) {
      const { unmount } = renderHome([
        { name: "热门电影", items: [{ id: item.title, title: item.title, year: "2026", cover: "", rate: item.rate, desc: "Hero description" }] },
      ]);

      await waitForHome();

      const hero = screen.getByLabelText("首页推荐轮播");
      const metadata = within(hero).getByLabelText("推荐内容信息");
      expect(within(metadata).getByText("热门电影")).toHaveClass("hero-meta-chip");
      expect(within(metadata).getByText("2026")).toHaveClass("hero-meta-chip");
      expect(within(metadata).queryByText(/豆瓣/)).toBeNull();

      unmount();
    }
  });

  it("shows the active hero movie description", async () => {
    renderHome([
      {
        name: "热门电影",
        items: [{ id: "movie-1", title: "Hero With Desc", year: "2026", cover: "", rate: "9.1", desc: "A real hero description." }],
      },
    ]);

    await waitForHome();

    const hero = screen.getByLabelText("首页推荐轮播");
    expect(within(hero).getByText("A real hero description.")).toHaveClass("hero-description");
    expect(within(hero).queryByText("搜索影片或剧集, KMTV 会聚合可用来源并进入播放页.")).toBeNull();
  });

  it("falls back to generic hero copy when no described hero candidate exists", async () => {
    renderHome([{ name: "热门电影", items: [{ id: "movie-1", title: "No Desc", year: "2026", cover: "", rate: "9.1" }] }]);

    await waitForHome();

    const hero = screen.getByLabelText("首页推荐轮播");
    expect(within(hero).getByText("搜索影片或剧集, KMTV 会聚合可用来源并进入播放页.")).toHaveClass("hero-description");
    expect(within(hero).getByRole("button", { name: "搜索播放" })).toBeInTheDocument();
  });

  it("shows N/A on home rail posters when Douban rating is unavailable", async () => {
    renderHome([
      {
        name: "热门电影",
        items: [
          { id: "movie-1", title: "Zero Rated Movie", year: "2026", cover: "", rate: "0" },
          { id: "movie-2", title: "Missing Rated Movie", year: "2026", cover: "" },
        ],
      },
    ]);

    await waitForHome();

    const rail = screen.getByRole("list", { name: "热门电影" });
    expect(within(within(rail).getByRole("button", { name: /Zero Rated Movie/ })).getByText("N/A")).toHaveClass(
      "poster-rating-badge",
    );
    expect(within(within(rail).getByRole("button", { name: /Missing Rated Movie/ })).getByText("N/A")).toHaveClass(
      "poster-rating-badge",
    );
  });

  it("presents large home sections as a horizontal rail", async () => {
    renderHome([{ name: "热门电影", items: makeItems("Movie", 24) }]);

    await waitForHome();

    const rail = screen.getByRole("list", { name: "热门电影" });
    expect(rail).toHaveClass("poster-rail");
    expect(screen.getAllByRole("listitem")).toHaveLength(24);
  });

  it("builds hero recommendations from multiple home sections", async () => {
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
      { name: "热门动漫", items: [{ id: "anime-1", title: "Anime Pick", year: "2026", desc: "Anime description" }] },
    ]);

    await waitForHome();

    expect(screen.getByRole("button", { name: "切换推荐: Movie Pick" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换推荐: Series Pick" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "切换推荐: Anime Pick" })).toBeInTheDocument();
  });

  it("switches the visible hero when selecting an indicator", async () => {
    const user = userEvent.setup();
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await waitForHome();
    await user.click(screen.getByRole("button", { name: "切换推荐: Series Pick" }));

    expect(screen.getByRole("heading", { name: "Series Pick" })).toBeInTheDocument();
    expect(screen.getByText("热门剧集", { selector: ".eyebrow" })).toBeInTheDocument();
  });

  it("keeps the outgoing hero visible during the next hero transition", async () => {
    const user = userEvent.setup();
    const { container } = renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await waitForHome();
    expect(container.querySelector(".hero-motion-stack-transitioning")).toBeNull();
    const currentTitle = container.querySelector(".hero-motion-enter h1")?.textContent ?? "";
    const nextIndicator = Array.from(container.querySelectorAll<HTMLButtonElement>(".hero-indicators button")).find(
      (button) => button.getAttribute("aria-pressed") !== "true",
    );
    expect(nextIndicator).toBeDefined();
    const nextTitle = nextIndicator?.getAttribute("aria-label")?.replace("切换推荐: ", "") ?? "";

    await user.click(nextIndicator!);

    expect(container.querySelectorAll(".hero-motion")).toHaveLength(2);
    expect(container.querySelector(".hero-motion-stack-transitioning")).not.toBeNull();
    expect(container.querySelector(".hero-motion-exit")?.textContent).toContain(currentTitle);
    expect(container.querySelector(".hero-motion-enter")?.textContent).toContain(nextTitle);
  });

  it("clears the hero transition state when the slide animation finishes", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { container } = renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await act(async () => {});
    await waitForHome();
    await user.click(screen.getByRole("button", { name: "切换推荐: Series Pick" }));

    expect(container.querySelector(".hero-motion-stack-transitioning")).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(980);
    });

    expect(container.querySelector(".hero-motion-stack-transitioning")).toBeNull();
    expect(container.querySelectorAll(".hero-motion")).toHaveLength(1);
  });

  it("slides in the direction of the selected carousel indicator", async () => {
    const user = userEvent.setup();
    const { container } = renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
      { name: "热门动漫", items: [{ id: "anime-1", title: "Anime Pick", year: "2026", desc: "Anime description" }] },
    ]);

    await waitForHome();
    const indicators = Array.from(container.querySelectorAll<HTMLButtonElement>(".hero-indicators button"));
    const currentIndex = indicators.findIndex((button) => button.getAttribute("aria-pressed") === "true");
    const nextIndex = (currentIndex + 1) % indicators.length;

    await user.click(indicators[nextIndex]);

    expect(container.querySelector(".hero-motion-enter-forward")).not.toBeNull();
    expect(container.querySelector(".hero-motion-exit-forward")).not.toBeNull();
  });

  it("keeps carousel indicators outside the animated hero layer", async () => {
    const user = userEvent.setup();
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await waitForHome();
    const indicators = screen.getByRole("button", { name: "切换推荐: Movie Pick" }).closest(".hero-indicators");
    expect(indicators).not.toBeNull();
    expect(indicators?.closest(".hero-motion")).toBeNull();

    await user.click(screen.getByRole("button", { name: "切换推荐: Series Pick" }));

    expect(screen.getByRole("button", { name: "切换推荐: Movie Pick" }).closest(".hero-indicators")).toBe(indicators);
    expect(screen.getByRole("heading", { name: "Series Pick" }).closest(".hero-motion")).not.toBeNull();
  });

  it("does not render carousel indicators for a single hero candidate", async () => {
    renderHome([{ name: "热门电影", items: [{ id: "movie-1", title: "Only Pick", year: "2026", desc: "Only description" }] }]);

    await waitForHome();

    expect(screen.getByRole("heading", { name: "Only Pick" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "切换推荐: Only Pick" })).toBeNull();
  });

  it("auto-advances the hero recommendation every 5 seconds", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await act(async () => {});
    await waitForHome();
    expect(screen.getByLabelText("首页推荐轮播")).toHaveAttribute("aria-live", "off");
    expect(screen.getByRole("heading", { name: "Movie Pick" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4900);
    });
    expect(screen.getByRole("heading", { name: "Movie Pick" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByRole("heading", { name: "Series Pick" })).toBeInTheDocument();
  });

  it("resumes auto-advance 3 seconds after selecting a carousel indicator", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
      { name: "热门动漫", items: [{ id: "anime-1", title: "Anime Pick", year: "2026", desc: "Anime description" }] },
    ]);

    await act(async () => {});
    await waitForHome();
    await user.click(screen.getByRole("button", { name: "切换推荐: Series Pick" }));
    expect(screen.getByRole("heading", { name: "Series Pick" })).toBeInTheDocument();
    expect(screen.getByLabelText("首页推荐轮播")).toHaveAttribute("aria-live", "polite");

    act(() => {
      vi.advanceTimersByTime(2900);
    });
    expect(screen.getByRole("heading", { name: "Series Pick" })).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByLabelText("首页推荐轮播")).toHaveAttribute("aria-live", "off");
    expect(screen.getByRole("heading", { name: "Anime Pick" })).toBeInTheDocument();
  });

  it("continues auto-advance while the hero is hovered", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await act(async () => {});
    await waitForHome();
    await user.hover(screen.getByLabelText("首页推荐轮播"));
    expect(screen.getByLabelText("首页推荐轮播")).toHaveAttribute("aria-live", "off");
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(screen.getByRole("heading", { name: "Series Pick" })).toBeInTheDocument();
  });

  it("keeps focus pause active after the pointer leaves", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.spyOn(Math, "random").mockReturnValue(0.99);
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderHome([
      { name: "热门电影", items: [{ id: "movie-1", title: "Movie Pick", year: "2026", desc: "Movie description" }] },
      { name: "热门剧集", items: [{ id: "series-1", title: "Series Pick", year: "2026", desc: "Series description" }] },
    ]);

    await act(async () => {});
    await waitForHome();
    const hero = screen.getByLabelText("首页推荐轮播");
    await user.hover(hero);
    act(() => {
      screen.getByRole("button", { name: "搜索播放" }).focus();
    });
    await user.unhover(hero);
    expect(hero).toHaveAttribute("aria-live", "polite");
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(screen.getByRole("heading", { name: "Movie Pick" })).toBeInTheDocument();

    act(() => {
      screen.getByRole("button", { name: "搜索播放" }).blur();
    });
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(hero).toHaveAttribute("aria-live", "off");
    expect(screen.getByRole("heading", { name: "Series Pick" })).toBeInTheDocument();
  });

  // ---- loading state ----
  it("renders the loading skeleton with aria-busy while the query is in-flight", () => {
    // Do not await waitForHome — capture the loading state before data arrives.
    //
    // 不等待 waitForHome — 在数据到达前捕获加载状态.
    renderHome();

    const main = document.querySelector("main.home-page");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(main).toHaveAttribute("aria-label", "正在加载推荐");
    expect(document.querySelector(".home-skeleton")).toBeInTheDocument();
  });

  // ---- error state ----
  // useDoubanHomeQuery has retry: 1 so the query retries once before settling to error.
  //
  // useDoubanHomeQuery 设置了 retry: 1, 因此 query 在失败前会重试一次.
  //
  // We wait up to 5 s to cover the retry delay in happy-dom's microtask environment.
  //
  // 等待最多 5 秒, 覆盖 happy-dom 微任务环境中的重试延迟.
  it("shows the error StatusState and search action when the Douban query fails", async () => {
    renderHomeError();

    // Wait for the skeleton to disappear (query settles to error after 1 retry).
    //
    // 等待骨架屏消失 (query 重试 1 次后失败, 结束加载状态).
    await waitForElementToBeRemoved(() => document.querySelector(".home-skeleton"), { timeout: 5000 });

    expect(screen.getByText("推荐暂时不可用")).toBeInTheDocument();
    expect(screen.getByText("可以直接搜索影片或剧集.")).toBeInTheDocument();
    // The "去搜索" error action navigates to /search.
    //
    // "去搜索" 错误操作导航至 /search.
    expect(screen.getByRole("button", { name: "去搜索" })).toBeInTheDocument();
  });

  it("navigates to /search when the error action button is clicked", async () => {
    const user = userEvent.setup();
    renderHomeError();

    await waitForElementToBeRemoved(() => document.querySelector(".home-skeleton"), { timeout: 5000 });

    // The error state should NOT also show an EmptyState.
    //
    // 错误状态不应同时显示 EmptyState.
    expect(screen.queryByText("暂无推荐内容")).toBeNull();

    await user.click(screen.getByRole("button", { name: "去搜索" }));

    expect(screen.getByTestId("location").textContent).toBe("/search");
  });

  // ---- empty state (success with zero sections) ----
  it("shows the EmptyState when the query succeeds with no sections", async () => {
    renderHome([]);

    await waitForHome();

    expect(screen.getByText("暂无推荐内容")).toBeInTheDocument();
    expect(screen.getByText("添加视频源后会显示推荐, 也可以直接搜索.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "搜索影片" })).toBeInTheDocument();
    // The EmptyState must not be accompanied by an error StatusState.
    //
    // EmptyState 不应同时出现错误 StatusState.
    expect(screen.queryByText("推荐暂时不可用")).toBeNull();
  });

  it("navigates to /search when the empty-state action button is clicked", async () => {
    const user = userEvent.setup();
    renderHome([]);

    await waitForHome();

    await user.click(screen.getByRole("button", { name: "搜索影片" }));

    expect(screen.getByTestId("location").textContent).toBe("/search");
  });

  // ---- poster tile navigation ----
  it("navigates to /search with the encoded title when a poster tile is clicked", async () => {
    const user = userEvent.setup();
    renderHome([{ name: "热门电影", items: [{ id: "m1", title: "Test Movie", year: "2026", cover: "" }] }]);

    await waitForHome();

    await user.click(screen.getByRole("button", { name: /Test Movie/ }));

    expect(screen.getByTestId("location").textContent).toBe("/search?q=Test%20Movie");
  });

  it("renders authenticated continue-watching items before recommendation rails", async () => {
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      apiOverrides: {
        listWatchHistory: async () => ({ items: [makeHistoryItem({ title: "Resume Me", episode: "第 2 集" })] }),
      },
    });

    await waitForHome();

    const historySection = await screen.findByRole("region", { name: "继续观看" });
    expect(within(historySection).getByRole("button", { name: "Resume Me, 第 2 集" })).toBeInTheDocument();
    const allSections = Array.from(document.querySelectorAll("section.rail-section"));
    expect(allSections[0]).toBe(historySection);
    expect(screen.getByRole("list", { name: "热门电影" })).toBeInTheDocument();
  });

  it("renders anonymous continue watching locally without requesting remote history", async () => {
    const listWatchHistory = vi.fn(async () => ({ items: [makeHistoryItem()] }));
    upsertAnonymousWatchHistory({
      source_key: "source-a",
      video_id: "video-a",
      title: "Anonymous Show",
      cover: "",
      episode: "01",
      group_index: 0,
      episode_index: 0,
      progress_sec: 60,
      duration_sec: 120,
      completed: false,
      event_time_ms: nextWatchHistoryEventTime(),
    });
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      authenticated: false,
      apiOverrides: {
        me: async () => ({ id: 0, username: "anonymous", role: "user" }),
        listWatchHistory,
      },
    });

    await waitForHome();
    await waitFor(() => expect(screen.getByRole("list", { name: "热门电影" })).toBeInTheDocument());

    expect(listWatchHistory).not.toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "继续观看" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Anonymous Show, 01" })).toBeInTheDocument();
  });

  it("clears anonymous continue watching locally without a network request", async () => {
    const user = userEvent.setup();
    const clearWatchHistory = vi.fn(async () => undefined);
    upsertAnonymousWatchHistory({
      source_key: "source-a",
      video_id: "video-a",
      title: "Anonymous Clear Me",
      cover: "",
      episode: "01",
      group_index: 0,
      episode_index: 0,
      progress_sec: 60,
      duration_sec: 120,
      completed: false,
      event_time_ms: nextWatchHistoryEventTime(),
    });
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      authenticated: false,
      apiOverrides: {
        me: async () => ({ id: 0, username: "anonymous", role: "user" }),
        clearWatchHistory,
      },
    });

    await waitForHome();
    expect(screen.getByRole("region", { name: "继续观看" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空观看记录" }));
    await user.click(screen.getByRole("button", { name: "清空" }));

    await waitFor(() => expect(screen.queryByRole("region", { name: "继续观看" })).toBeNull());
    expect(clearWatchHistory).not.toHaveBeenCalled();
  });

  it("hides anonymous history after login and restores it after logout", async () => {
    upsertAnonymousWatchHistory({
      source_key: "source-a",
      video_id: "video-a",
      title: "Anonymous Restore",
      cover: "",
      episode: "01",
      group_index: 0,
      episode_index: 0,
      progress_sec: 60,
      duration_sec: 120,
      completed: false,
      event_time_ms: nextWatchHistoryEventTime(),
    });
    const { tokenStore } = renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      authenticated: false,
      apiOverrides: {
        me: async () => ({ id: 0, username: "anonymous", role: "user" }),
        listWatchHistory: async () => ({ items: [] }),
      },
    });

    await waitForHome();
    expect(screen.getByRole("button", { name: "Anonymous Restore, 01" })).toBeInTheDocument();

    act(() => {
      tokenStore.set(makeAuthSnapshot(7));
    });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Anonymous Restore, 01" })).toBeNull());

    act(() => {
      tokenStore.clear("logout");
    });
    await waitFor(() => expect(screen.getByRole("button", { name: "Anonymous Restore, 01" })).toBeInTheDocument());
  });

  it("keeps recommendations usable when history fails", async () => {
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      apiOverrides: {
        listWatchHistory: async () => { throw new Error("history unavailable"); },
      },
    });

    await waitForHome();

    expect(await screen.findByRole("list", { name: "热门电影" })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "继续观看" })).toBeNull();
    expect(screen.queryByText("推荐暂时不可用")).toBeNull();
  });

  it("navigates continue-watching cards to encoded aggregate search", async () => {
    const user = userEvent.setup();
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      apiOverrides: {
        listWatchHistory: async () => ({ items: [makeHistoryItem({ title: "世界的主人 & Friends", episode: "EP 1" })] }),
      },
    });

    await waitForHome();
    await user.click(await screen.findByRole("button", { name: "世界的主人 & Friends, EP 1" }));

    expect(screen.getByTestId("location").textContent).toBe("/search?q=%E4%B8%96%E7%95%8C%E7%9A%84%E4%B8%BB%E4%BA%BA+%26+Friends");
  });

  it("clears confirmed continue-watching history and removes the rail", async () => {
    const user = userEvent.setup();
    const clearWatchHistory = vi.fn(async () => undefined);
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      apiOverrides: {
        listWatchHistory: async () => ({
          items: [makeHistoryItem({ title: "Clear Me", event_time_ms: 1 })],
        }),
        clearWatchHistory,
      },
    });

    await waitForHome();
    expect(await screen.findByRole("region", { name: "继续观看" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "清空观看记录" }));
    await user.click(screen.getByRole("button", { name: "清空" }));

    await waitFor(() => expect(clearWatchHistory).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("region", { name: "继续观看" })).toBeNull());
  });

  it("keeps history visible and reports an error when clearing fails", async () => {
    const user = userEvent.setup();
    renderHome([{ name: "热门电影", items: makeItems("Movie", 3) }], {
      apiOverrides: {
        listWatchHistory: async () => ({ items: [makeHistoryItem({ title: "Keep Me" })] }),
        clearWatchHistory: async () => { throw new Error("server unavailable"); },
      },
    });

    await waitForHome();
    expect(await screen.findByRole("region", { name: "继续观看" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "清空观看记录" }));
    await user.click(screen.getByRole("button", { name: "清空" }));

    await waitFor(() => expect(useToastStore.getState().items).toHaveLength(1));
    expect(useToastStore.getState().items[0]).toMatchObject({
      tone: "error",
      title: "无法清空观看记录",
      description: "server unavailable",
    });
    expect(screen.getByRole("region", { name: "继续观看" })).toBeInTheDocument();
  });

  // ---- poster tile without year ----
  it("omits the year span on poster tiles when the item has no year field", async () => {
    renderHome([{ name: "热门电影", items: [{ id: "no-year", title: "No Year Movie", cover: "" }] }]);

    await waitForHome();

    const rail = screen.getByRole("list", { name: "热门电影" });
    const tile = within(rail).getByRole("button", { name: /No Year Movie/ });
    expect(within(tile).queryByText(/^\d{4}$/)).toBeNull();
  });
});
