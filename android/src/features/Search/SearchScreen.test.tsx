// SearchScreen tests: input/submit/SSE → results, progress display, sync fallback, history.
// SearchScreen 测试: 输入提交/SSE → 结果、进度、同步回退、历史.

// jest hoists jest.mock() factories above all variable declarations, so any reference inside the
// factory MUST start with the `mock` prefix. mockNavigate is the supported escape hatch.
// jest 会把 jest.mock() factory 提升至所有变量声明之前. factory 内的引用必须以 mock 开头.
const mockNavigate = jest.fn();
jest.mock("@react-navigation/native", () => ({
  __esModule: true,
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ navigate: mockNavigate, goBack: jest.fn(), canGoBack: () => false }),
}));

import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import type { SearchAPI } from "@/api/search";
import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n } from "@/i18n";
import type { SearchRouteParams } from "@/navigation/types";
import { _resetForTests as resetMMKV } from "@/storage/mmkv";

import { SearchScreen, SearchScreenContext } from "./SearchScreen";

function buildAPI(overrides: Partial<SearchAPI> = {}): SearchAPI {
  return {
    search: jest.fn(),
    searchStream: jest.fn(),
    ...overrides,
  };
}

const wireSource = {
  source_key: "s1", source_name: "S1", is_adult: false,
  video_id: "v1", duration_ms: 0, episodes: [],
};

const freshSource = {
  source_key: "fresh", source_name: "Fresh", is_adult: false,
  video_id: "fresh-v1", duration_ms: 0, episodes: [],
};

const safeAreaMetrics = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 0, left: 0, right: 0, bottom: 0 },
};

async function renderScreen(api: SearchAPI, params?: string | SearchRouteParams) {
  resetMMKV();
  const i18n = await initI18n("en");
  const routeParams = typeof params === "string" ? { initialQuery: params } : params;
  return render(
    <SafeAreaProvider initialMetrics={safeAreaMetrics}>
      <NavigationContainer>
        <I18nextProvider i18n={i18n}>
          <ThemeProvider override="light">
            <SearchScreenContext.Provider value={{ api, serverURL: "https://api.test" }}>
              <SearchScreen route={{ key: "k", name: "Search", params: routeParams }} />
            </SearchScreenContext.Provider>
          </ThemeProvider>
        </I18nextProvider>
      </NavigationContainer>
    </SafeAreaProvider>,
  );
}

describe("SearchScreen", () => {
  it("renders the input with placeholder and empty history block when no history", async () => {
    const api = buildAPI();
    await renderScreen(api);
    expect(screen.getByPlaceholderText("Search videos...")).toBeTruthy();
    expect(screen.queryByText("Search history")).toBeNull();
  });

  it("submitting calls searchStream and renders results", async () => {
    const api = buildAPI({
      searchStream: jest.fn(async () => ({ results: [
        { title: "Result 1", type: "tv", year: "2024", cover: "", desc: "", sources: [wireSource] },
      ] })),
    });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "kungfu");
    fireEvent(screen.getByPlaceholderText("Search videos..."), "submitEditing");
    await waitFor(() => expect(api.searchStream).toHaveBeenCalled());
    const [[query, , opts]] = (api.searchStream as jest.Mock).mock.calls;
    expect(query).toBe("kungfu");
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    await waitFor(() => expect(screen.getByText("Result 1")).toBeTruthy());
    expect(screen.queryByText("Search history")).toBeNull();
  });

  it("tapping the explicit submit button starts a search", async () => {
    const api = buildAPI({
      searchStream: jest.fn(async () => ({ results: [
        { title: "Button Result", type: "movie", year: "2025", cover: "", desc: "", sources: [wireSource] },
      ] })),
    });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "button");
    fireEvent.press(screen.getByTestId("searchSubmitButton"));
    await waitFor(() => expect(api.searchStream).toHaveBeenCalledWith(
      "button",
      expect.any(Function),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    ));
    await waitFor(() => expect(screen.getByText("Button Result")).toBeTruthy());
  });

  it("renders the progress line while streaming", async () => {
    let progressFn!: (p: { phase: string; completed: number; total: number }) => void;
    const api = buildAPI({
      searchStream: jest.fn((_q, onProgress) => new Promise(() => {
        progressFn = onProgress;
      })),
    });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "k");
    fireEvent(screen.getByPlaceholderText("Search videos..."), "submitEditing");
    await waitFor(() => expect(api.searchStream).toHaveBeenCalled());
    act(() => progressFn({ phase: "searching", completed: 2, total: 5 }));
    await waitFor(() => expect(screen.getByText(/Searching available sources 2 \/ 5/)).toBeTruthy());
    act(() => progressFn({ phase: "probing", completed: 1, total: 3 }));
    await waitFor(() => expect(screen.getByText(/Probing CDN availability 1 \/ 3/)).toBeTruthy());
    expect(screen.getAllByTestId("searchSkeletonCover").length).toBeGreaterThan(0);
  });

  it("falls back to sync search on SSE failure", async () => {
    const api = buildAPI({
      searchStream: jest.fn(async () => { throw new Error("sse down"); }),
      search: jest.fn(async () => ({ results: [
        { title: "Fallback", type: "", year: "", cover: "", desc: "", sources: [wireSource] },
      ] })),
    });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "x");
    fireEvent(screen.getByPlaceholderText("Search videos..."), "submitEditing");
    await waitFor(() => expect(api.search).toHaveBeenCalledWith("x"));
    await waitFor(() => expect(screen.getByText("Fallback")).toBeTruthy());
  });

  it("shows the empty-results state when both stream and fallback return zero results", async () => {
    const api = buildAPI({ searchStream: jest.fn(async () => ({ results: [] })) });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "none");
    fireEvent(screen.getByPlaceholderText("Search videos..."), "submitEditing");
    await waitFor(() => expect(screen.getByText("No results found")).toBeTruthy());
    expect(screen.queryByText("Search history")).toBeNull();
  });

  it("clicking a history chip re-submits the query", async () => {
    const api = buildAPI({
      searchStream: jest.fn(async () => ({ results: [
        { title: "Result 1", type: "", year: "", cover: "", desc: "", sources: [wireSource] },
      ] })),
    });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "kungfu");
    fireEvent(screen.getByPlaceholderText("Search videos..."), "submitEditing");
    await waitFor(() => expect(screen.getByText("Result 1")).toBeTruthy());
    expect(screen.queryByText("Search history")).toBeNull();
    fireEvent.press(screen.getByTestId("searchClearButton"));
    await waitFor(() => expect(screen.getByText("Search history")).toBeTruthy());
    fireEvent.press(screen.getByText("kungfu"));
    expect((api.searchStream as jest.Mock).mock.calls.filter((c) => c[0] === "kungfu").length).toBeGreaterThanOrEqual(2);
  });

  it("respects initialQuery route param: auto-submits on mount", async () => {
    const api = buildAPI({ searchStream: jest.fn(async () => ({ results: [] })) });
    await renderScreen(api, "preset");
    await waitFor(() => expect(api.searchStream).toHaveBeenCalled());
    expect((api.searchStream as jest.Mock).mock.calls[0]![0]).toBe("preset");
  });

  it("resets to a clean state when re-navigated with empty initialQuery (Home search button)", async () => {
    // Regression: the Search instance is reused by native-stack when Home re-navigates to it.
    // Tapping the home search button passes initialQuery="" — the previous query / results / "No
    // results found" must clear, not stay frozen on whatever was last searched.
    // 回归测试: native-stack 在 Home 重新导航到 Search 时会复用同一实例. 点 Home 搜索按钮传入
    // initialQuery="", 之前的 query / 结果 / "No results found" 必须清掉, 不能停留在上次搜索.
    const api = buildAPI({
      searchStream: jest.fn(async () => ({
        results: [{ title: "StaleResult", type: "Movie", year: "2024", cover: "/c.jpg", desc: "", sources: [wireSource] }],
      })),
    });
    resetMMKV();
    const i18n = await initI18n("en");
    const ui = (params: { initialQuery: string } | undefined) => (
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <NavigationContainer>
          <I18nextProvider i18n={i18n}>
            <ThemeProvider override="light">
              <SearchScreenContext.Provider value={{ api, serverURL: "https://api.test" }}>
                <SearchScreen route={{ key: "k", name: "Search", params }} />
              </SearchScreenContext.Provider>
            </ThemeProvider>
          </I18nextProvider>
        </NavigationContainer>
      </SafeAreaProvider>
    );
    const { rerender } = render(ui({ initialQuery: "kungfu" }));
    await waitFor(() => expect(screen.getByText("StaleResult")).toBeTruthy());

    await act(async () => {
      rerender(ui({ initialQuery: "" }));
    });
    await waitFor(() => expect(screen.queryByText("StaleResult")).toBeNull());
    expect(screen.queryByText("No results found")).toBeNull();
    expect((screen.getByPlaceholderText("Search videos...").props as { value?: string }).value).toBe("");
  });

  it("rerendering with the same initialQuery does NOT re-fire the search (effect is value-stable)", async () => {
    // Safety net: useEffect deps = [initialQuery]; React Object.is equality should skip re-runs when
    // the navigation param string is unchanged. If anyone later flips the dep array or wraps the
    // string in a fresh object, this test catches the silent regression.
    // 安全网测试: useEffect deps 是 [initialQuery], React 用 Object.is 在字符串相同时跳过重跑.
    // 如果有人改了依赖数组或包了一层 fresh 对象, 这条测试会接住静默 regression.
    const api = buildAPI({ searchStream: jest.fn(async () => ({ results: [] })) });
    resetMMKV();
    const i18n = await initI18n("en");
    const ui = (params: { initialQuery: string }) => (
      <SafeAreaProvider initialMetrics={safeAreaMetrics}>
        <NavigationContainer>
          <I18nextProvider i18n={i18n}>
            <ThemeProvider override="light">
              <SearchScreenContext.Provider value={{ api, serverURL: "https://api.test" }}>
                <SearchScreen route={{ key: "k", name: "Search", params }} />
              </SearchScreenContext.Provider>
            </ThemeProvider>
          </I18nextProvider>
        </NavigationContainer>
      </SafeAreaProvider>
    );
    const { rerender } = render(ui({ initialQuery: "preset" }));
    await waitFor(() => expect(api.searchStream).toHaveBeenCalledTimes(1));
    await act(async () => { rerender(ui({ initialQuery: "preset" })); });
    expect(api.searchStream).toHaveBeenCalledTimes(1);
  });

  it("tapping a result navigates to Player with the destination payload", async () => {
    mockNavigate.mockClear();
    const api = buildAPI({
      searchStream: jest.fn(async () => ({ results: [
        { title: "Some Movie", type: "Movie", year: "2024", cover: "/c.jpg", desc: "", sources: [wireSource] },
      ] })),
    });
    await renderScreen(api);
    fireEvent.changeText(screen.getByPlaceholderText("Search videos..."), "kungfu");
    fireEvent(screen.getByPlaceholderText("Search videos..."), "submitEditing");
    await waitFor(() => expect(screen.getByText("Some Movie")).toBeTruthy());
    fireEvent.press(screen.getByText("Some Movie"));
    expect(mockNavigate).toHaveBeenCalledWith("Player", expect.objectContaining({
      title: "Some Movie",
      sourceKey: "s1",
      videoId: "v1",
      coverHint: "/c.jpg",
    }));
  });

  it("continue-watching search prefers the previous source when the refreshed result still has it", async () => {
    mockNavigate.mockClear();
    const api = buildAPI({
      searchStream: jest.fn(async () => ({ results: [
        {
          title: "Continue Title",
          type: "TV",
          year: "2024",
          cover: "/fresh.jpg",
          desc: "",
          sources: [freshSource, wireSource],
        },
      ] })),
    });
    await renderScreen(api, {
      initialQuery: "Continue Title",
      resumeHint: {
        title: "Continue Title",
        sourceKey: "s1",
        videoId: "v1",
        coverHint: "/old.jpg",
        episodeIndex: 3,
        episodeName: "E4",
      },
    });
    await waitFor(() => expect(screen.getByText("Continue Title")).toBeTruthy());
    fireEvent.press(screen.getByText("Continue Title"));
    expect(mockNavigate).toHaveBeenCalledWith("Player", expect.objectContaining({
      title: "Continue Title",
      sourceKey: "s1",
      videoId: "v1",
      coverHint: "/fresh.jpg",
      resumeIntent: { episodeIndex: 3, episodeName: "E4" },
    }));
  });

  it("continue-watching search falls back to a fresh source when the old source disappeared", async () => {
    mockNavigate.mockClear();
    const api = buildAPI({
      searchStream: jest.fn(async () => ({ results: [
        {
          title: "Continue Title",
          type: "TV",
          year: "2024",
          cover: "/fresh.jpg",
          desc: "",
          sources: [freshSource],
        },
      ] })),
    });
    await renderScreen(api, {
      initialQuery: "Continue Title",
      resumeHint: {
        title: "Continue Title",
        sourceKey: "stale",
        videoId: "stale-v1",
        coverHint: "/old.jpg",
        episodeIndex: 3,
        episodeName: "E4",
      },
    });
    await waitFor(() => expect(screen.getByText("Continue Title")).toBeTruthy());
    fireEvent.press(screen.getByText("Continue Title"));
    expect(mockNavigate).toHaveBeenCalledWith("Player", expect.objectContaining({
      title: "Continue Title",
      sourceKey: "fresh",
      videoId: "fresh-v1",
      coverHint: "/fresh.jpg",
      resumeIntent: { episodeIndex: 3, episodeName: "E4" },
    }));
  });
});
