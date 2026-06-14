// CategoriesScreen integration tests: skeleton → tabs/chips/grid → tab switch resets,
// poster tap fires onSearchTitle, error retry, N/A rating, unconfigured, empty, load-more.
// CategoriesScreen 集成测试: 骨架屏 → tabs/chips/grid → 切换 tab 重置, 海报点击触发 onSearchTitle,
// 错误重试, N/A 评分, 未配置态, 空态, 加载更多.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { NavigationContainer } from "@react-navigation/native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { DoubanAPI } from "@/api/douban";
import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n } from "@/i18n";
import { _resetForTests as resetMMKV } from "@/storage/mmkv";
import { categoriesStore } from "@/store/categoriesStore";

import { CategoriesScreen, CategoriesScreenContext } from "./CategoriesScreen";

const groupsPayload = {
  categories: [
    {
      key: "movie", name: "电影", douban_kind: "movie", format: "",
      subcategories: [{ name: "全部", tag: "" }, { name: "热门", tag: "热门" }],
      regions: [{ name: "全部", value: "" }, { name: "华语", value: "华语" }],
    },
    {
      key: "tv", name: "剧集", douban_kind: "tv", format: "season",
      subcategories: [{ name: "全部", tag: "" }],
      regions: [],
    },
  ],
};

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

function buildAPI(overrides: Partial<DoubanAPI> = {}): DoubanAPI {
  return {
    doubanHome: jest.fn(),
    doubanCategories: jest.fn(async () => groupsPayload),
    doubanRecommendFilter: jest.fn(async () => ({ items: [
      { id: "m1", title: "Movie 1", cover: "", rate: "8.0", year: "2024" },
      { id: "m2", title: "Movie 2", cover: "", rate: "0", year: "2023" },
    ] })),
    ...overrides,
  };
}

async function renderScreen(api: DoubanAPI, onSearchTitle: (q: string) => void = jest.fn()) {
  resetMMKV();
  categoriesStore.getState().resetAll();
  categoriesStore.getState().hydrate("https://api.test");
  const i18n = await initI18n("en");
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <NavigationContainer>
        <QueryClientProvider client={qc}>
          <I18nextProvider i18n={i18n}>
            <ThemeProvider override="light">
              <CategoriesScreenContext.Provider value={{ api, serverURL: "https://api.test", onSearchTitle }}>
                <CategoriesScreen />
              </CategoriesScreenContext.Provider>
            </ThemeProvider>
          </I18nextProvider>
        </QueryClientProvider>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

describe("CategoriesScreen", () => {
  it("renders skeleton while categories load", async () => {
    let resolve!: (v: typeof groupsPayload) => void;
    const api = buildAPI({ doubanCategories: jest.fn(() => new Promise((res) => { resolve = res; })) });
    await renderScreen(api);
    expect(screen.getByTestId("categoriesLoading")).toBeTruthy();
    resolve(groupsPayload);
    await waitFor(() => expect(screen.queryByTestId("categoriesLoading")).toBeNull());
  });

  it("renders tabs + chips + grid after success", async () => {
    const api = buildAPI();
    await renderScreen(api);
    await waitFor(() => expect(screen.getByText("电影")).toBeTruthy());
    expect(screen.getByText("剧集")).toBeTruthy();
    expect(screen.getByText("热门")).toBeTruthy();
    expect(screen.getByText("华语")).toBeTruthy();
    await waitFor(() => expect(screen.getByText("Movie 1")).toBeTruthy());
  });

  it("switching tab resets sub/region (calls doubanRecommendFilter again with new kind)", async () => {
    const api = buildAPI();
    await renderScreen(api);
    await waitFor(() => expect(api.doubanRecommendFilter).toHaveBeenCalled());
    const firstCall = (api.doubanRecommendFilter as jest.Mock).mock.calls[0]![0];
    expect(firstCall.kind).toBe("movie");

    fireEvent.press(screen.getByText("剧集"));
    await waitFor(() => {
      const last = (api.doubanRecommendFilter as jest.Mock).mock.calls.at(-1)![0];
      expect(last.kind).toBe("tv");
    });
  });

  it("tapping a poster calls onSearchTitle with the item title", async () => {
    const onSearchTitle = jest.fn();
    const api = buildAPI();
    await renderScreen(api, onSearchTitle);
    await waitFor(() => expect(screen.getByText("Movie 1")).toBeTruthy());
    fireEvent.press(screen.getByText("Movie 1"));
    expect(onSearchTitle).toHaveBeenCalledWith("Movie 1");
  });

  it("shows error state on doubanCategories failure with a Retry button", async () => {
    const api = buildAPI({ doubanCategories: jest.fn(async () => { throw new Error("boom"); }) });
    await renderScreen(api);
    // useCategoriesQuery sets `retry: 1`; retry backoff can push isError past 1s.
    // useCategoriesQuery 设置 retry: 1, 退避可能使 isError 超过 1s, 这里放宽到 3s.
    await waitFor(
      () => expect(screen.getByText("Failed to load categories")).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("renders a rating badge of 'N/A' when item rate is empty or '0'", async () => {
    const api = buildAPI();
    await renderScreen(api);
    await waitFor(() => expect(screen.getByText("Movie 1")).toBeTruthy());
    expect(screen.getAllByText("8.0").length).toBeGreaterThan(0);
    expect(screen.getAllByText("N/A").length).toBeGreaterThan(0);
  });

  it("renders the unconfigured fallback when no api/serverURL in context", async () => {
    resetMMKV();
    categoriesStore.getState().resetAll();
    const i18n = await initI18n("en");
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <NavigationContainer>
          <QueryClientProvider client={qc}>
            <I18nextProvider i18n={i18n}>
              <ThemeProvider override="light">
                <CategoriesScreen />
              </ThemeProvider>
            </I18nextProvider>
          </QueryClientProvider>
        </NavigationContainer>
      </SafeAreaProvider>,
    );
    expect(screen.getByTestId("categoriesUnconfigured")).toBeTruthy();
  });

  it("renders the empty state when items list is []", async () => {
    const api = buildAPI({ doubanRecommendFilter: jest.fn(async () => ({ items: [] })) });
    await renderScreen(api);
    await waitFor(() => expect(screen.getByText("No results")).toBeTruthy());
    expect(screen.getByText("Adjust the filter and try again.")).toBeTruthy();
  });

  it("renders the load-more footer when hasNextPage and calls fetchNextPage on onEndReached", async () => {
    const fullPage = new Array(20).fill(null).map((_, i) => ({
      id: `m${i}`, title: `M${i}`, cover: "", rate: "", year: "",
    }));
    const calls: Array<{ start?: number }> = [];
    const api = buildAPI({
      doubanRecommendFilter: jest.fn(async (filter) => {
        calls.push(filter);
        return filter.start === 0 ? { items: fullPage } : { items: [] };
      }),
    });
    await renderScreen(api);
    await waitFor(() => expect(screen.getByText("M0")).toBeTruthy());
    expect(screen.getByText("Loading more")).toBeTruthy();

    const grid = screen.getByTestId("categoryGrid");
    await act(async () => {
      grid.props.onEndReached?.();
    });
    await waitFor(() => expect(calls.some((c) => c.start === 20)).toBe(true));
  });
});

describe("pickNumColumns (responsive grid breakpoints)", () => {
  it("returns 3 for widths under 600 dp", () => {
    const { pickNumColumns } = require("./CategoriesScreen") as { pickNumColumns: (w: number) => number };
    expect(pickNumColumns(0)).toBe(3);
    expect(pickNumColumns(599)).toBe(3);
  });
  it("returns 4 for widths in [600, 840) dp", () => {
    const { pickNumColumns } = require("./CategoriesScreen") as { pickNumColumns: (w: number) => number };
    expect(pickNumColumns(600)).toBe(4);
    expect(pickNumColumns(839)).toBe(4);
  });
  it("returns 5 for widths ≥ 840 dp", () => {
    const { pickNumColumns } = require("./CategoriesScreen") as { pickNumColumns: (w: number) => number };
    expect(pickNumColumns(840)).toBe(5);
    expect(pickNumColumns(1280)).toBe(5);
  });
});
