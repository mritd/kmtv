/**
 * Tests for CategoriesPage — tabs, filter chips, grid, pagination, and all status states.
 * CategoriesPage 测试 — tab、筛选胶囊、网格、分页, 以及所有状态分支.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, waitForElementToBeRemoved, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CategoryGroup, DoubanItem, DoubanRecommendFilter } from "@/api/types";
import { RECOMMEND_PAGE_SIZE } from "@/api/viewerHooks";
import { APIProvider } from "@/api/context";
import type { APIClient } from "@/api/client";
import { createTestAPI } from "@/test/testAPI";

import { CategoriesPage } from "./CategoriesPage";

// ---------------------------------------------------------------------------
// IntersectionObserver mock — captures instances so tests can trigger intersection.
// IntersectionObserver mock — 记录实例, 使测试能够触发相交回调.
// ---------------------------------------------------------------------------
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  root = null;
  rootMargin = "";
  thresholds: ReadonlyArray<number> = [];
  constructor(cb: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.callback = cb;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  // trigger simulates the sentinel scrolling into view.
  // trigger 模拟哨兵滚入视口.
  trigger() {
    this.callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
  }
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures
// 测试夹具
// ---------------------------------------------------------------------------
const categories: CategoryGroup[] = [
  {
    key: "movie",
    name: "电影",
    douban_kind: "movie",
    format: "",
    subcategories: [
      { name: "全部", tag: "" },
      { name: "喜剧", tag: "喜剧" },
    ],
    regions: [
      { name: "全部", value: "" },
      { name: "美国", value: "美国" },
    ],
  },
  {
    key: "show",
    name: "综艺",
    douban_kind: "tv",
    format: "tv",
    // Sub-category name is deliberately different from the group name to avoid an accessible-name
    // collision in tests; it carries its own kind "tv" so the filter uses tag "综艺".
    // 子分类名称刻意与分组名不同, 避免测试中可访问名冲突; 其自带 kind "tv", 因此筛选使用 tag "综艺".
    subcategories: [{ name: "全部", tag: "综艺", kind: "tv", format: "show" }],
    regions: [],
  },
];

// itemsFor returns a page of items whose titles encode the active kind+tag, so assertions can prove
// which filter produced the list. The `count` controls hasNextPage (full page → more).
// itemsFor 返回标题编码了当前 kind+tag 的一页条目, 便于断言是哪组筛选产生了列表. count 控制 hasNextPage.
function itemsFor(filter: DoubanRecommendFilter, count: number): DoubanItem[] {
  const start = filter.start ?? 0;
  const label = `${filter.kind}-${filter.tag || "all"}`;
  return Array.from({ length: count }, (_, i) => ({
    id: `${label}-${start + i}`,
    title: `${label} #${start + i}`,
    year: "2026",
    rate: "8.0",
    cover: "",
  }));
}

function LocationDisplay() {
  const location = useLocation();
  return <span data-testid="location">{location.pathname + location.search}</span>;
}

function renderPage(overrides: Partial<APIClient> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const api = createTestAPI({
    doubanCategories: async () => ({ categories }),
    doubanRecommendFilter: async (filter) => ({ items: itemsFor(filter, RECOMMEND_PAGE_SIZE) }),
    ...overrides,
  });
  return render(
    <APIProvider value={api}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/categories"]}>
          <LocationDisplay />
          <CategoriesPage />
        </MemoryRouter>
      </QueryClientProvider>
    </APIProvider>,
  );
}

async function waitForGrid() {
  await waitForElementToBeRemoved(() => document.querySelector(".categories-skeleton"), { timeout: 5000 });
}

describe("CategoriesPage", () => {
  it("renders the loading skeleton with aria-busy while category metadata loads", () => {
    renderPage();
    const main = document.querySelector("main.categories-page");
    expect(main).toHaveAttribute("aria-busy", "true");
    expect(document.querySelector(".categories-skeleton")).toBeInTheDocument();
  });

  it("renders tabs, sub-category chips, region chips, and the first item page", async () => {
    renderPage();
    await waitForGrid();

    // Tabs for both groups.
    expect(screen.getByRole("button", { name: "电影" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "综艺" })).toBeInTheDocument();
    // Sub-category + region chips for the default (movie) group.
    expect(screen.getByRole("button", { name: "喜剧" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "美国" })).toBeInTheDocument();
    // Default selection resolves to movie + "全部" tag → items labelled "movie-all".
    const grid = screen.getByRole("list", { name: "分类" });
    expect(within(grid).getAllByRole("listitem").length).toBe(RECOMMEND_PAGE_SIZE);
    expect(within(grid).getByRole("button", { name: /movie-all #0/ })).toBeInTheDocument();
  });

  it("marks the active tab with aria-pressed", async () => {
    renderPage();
    await waitForGrid();
    expect(screen.getByRole("button", { name: "电影" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "综艺" })).toHaveAttribute("aria-pressed", "false");
  });

  it("hides the region row for a group without regions", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForGrid();

    await user.click(screen.getByRole("button", { name: "综艺" }));
    // After switching to 综艺 (no regions), the movie-only region chip disappears.
    await waitFor(() => expect(screen.queryByRole("button", { name: "美国" })).toBeNull());
    expect(document.querySelector(".category-chip-row-region")).toBeNull();
  });

  it("switches the item list when a different category tab is selected", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForGrid();

    await user.click(screen.getByRole("button", { name: "综艺" }));
    // 综艺 sub-category carries its own kind "tv" → items labelled "tv-综艺".
    await waitFor(() => expect(screen.getByRole("button", { name: /tv-综艺 #0/ })).toBeInTheDocument());
    expect(screen.getByRole("button", { name: "综艺" })).toHaveAttribute("aria-pressed", "true");
  });

  it("refetches with the new tag when a sub-category chip is selected", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForGrid();

    await user.click(screen.getByRole("button", { name: "喜剧" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /movie-喜剧 #0/ })).toBeInTheDocument());
  });

  it("navigates to /search with the encoded title when a poster is clicked", async () => {
    const user = userEvent.setup();
    renderPage();
    await waitForGrid();

    const grid = screen.getByRole("list", { name: "分类" });
    await user.click(within(grid).getByRole("button", { name: /movie-all #0/ }));
    expect(screen.getByTestId("location").textContent).toBe("/search?q=movie-all%20%230");
  });

  it("loads the next page when the sentinel intersects, deduplicating overlaps", async () => {
    // Page 0 returns a full page (hasNextPage); page 1 returns a short page (end of list).
    // 第 0 页满页 (有下一页); 第 1 页不足整页 (列表结束).
    const api = {
      doubanRecommendFilter: async (filter: DoubanRecommendFilter) =>
        ({ items: itemsFor(filter, filter.start ? RECOMMEND_PAGE_SIZE - 1 : RECOMMEND_PAGE_SIZE) }),
    };
    renderPage(api);
    await waitForGrid();

    const gridBefore = screen.getByRole("list", { name: "分类" });
    expect(within(gridBefore).getAllByRole("listitem")).toHaveLength(RECOMMEND_PAGE_SIZE);

    act(() => {
      MockIntersectionObserver.instances.at(-1)?.trigger();
    });

    await waitFor(() => {
      const grid = screen.getByRole("list", { name: "分类" });
      expect(within(grid).getAllByRole("listitem").length).toBe(RECOMMEND_PAGE_SIZE * 2 - 1);
    });
  });

  it("keeps a persistent loading indicator while more pages exist, and removes it on the final page", async () => {
    // Full first page → more pages exist → the indicator must stay visible so the partial last row
    // never reads as "all loaded".
    // 首页满页 → 还有更多 → 指示必须常驻可见, 使残缺的最后一行不被误读为「已全部加载」.
    const { unmount } = renderPage();
    await waitForGrid();
    expect(screen.getByRole("status", { name: "正在加载更多" })).toBeInTheDocument();
    unmount();

    // Short first page → no more pages → no indicator (the list genuinely ends).
    // 首页不足整页 → 没有更多 → 不显示指示 (列表确实到底).
    renderPage({ doubanRecommendFilter: async () => ({ items: itemsFor({ kind: "movie" }, RECOMMEND_PAGE_SIZE - 1) }) });
    await waitForGrid();
    expect(screen.queryByRole("status", { name: "正在加载更多" })).toBeNull();
  });

  it("prefetches the next page with a rootMargin before the sentinel is on screen", async () => {
    renderPage();
    await waitForGrid();
    // Eager prefetch: the observer fires ~800px before the sentinel is visible so the next rows
    // arrive while the user is still scrolling the current ones.
    // 提前预取: 观察器在哨兵可见前约 800px 触发, 使下一批行在用户仍浏览当前行时就到位.
    const observer = MockIntersectionObserver.instances.at(-1);
    expect(observer?.options?.rootMargin).toBe("800px 0px");
  });

  it("shows the page-level error state with retry when the category query fails", async () => {
    renderPage({ doubanCategories: async () => { throw new Error("boom"); } });
    await waitForElementToBeRemoved(() => document.querySelector(".categories-skeleton"), { timeout: 5000 });

    expect(screen.getByText("分类暂时不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
    // The header still renders so the page is not blank.
    expect(screen.getByRole("heading", { name: "分类" })).toBeInTheDocument();
  });

  it("shows the in-grid error state when the recommend query fails", async () => {
    renderPage({ doubanRecommendFilter: async () => { throw new Error("gateway"); } });
    await waitForElementToBeRemoved(() => document.querySelector(".categories-skeleton"), { timeout: 5000 });

    // Filters still render (categories succeeded), and the grid area shows the error.
    expect(screen.getByRole("button", { name: "电影" })).toBeInTheDocument();
    expect(screen.getByText("分类暂时不可用")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "重试" })).toBeInTheDocument();
  });

  it("shows the empty state when the recommend query returns no items", async () => {
    renderPage({ doubanRecommendFilter: async () => ({ items: [] }) });
    await waitForGrid();

    expect(screen.getByText("没有内容")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "分类" })).toBeNull();
  });

  it("omits the year span on posters without a year field", async () => {
    renderPage({
      doubanRecommendFilter: async () => ({ items: [{ id: "no-year", title: "No Year", cover: "" }] }),
    });
    await waitForGrid();

    const grid = screen.getByRole("list", { name: "分类" });
    const tile = within(grid).getByRole("button", { name: /No Year/ });
    expect(within(tile).queryByText(/^\d{4}$/)).toBeNull();
  });
});
