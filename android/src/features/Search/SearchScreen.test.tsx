// SearchScreen tests: input/submit/SSE → results, progress display, sync fallback, history.
// SearchScreen 测试: 输入提交/SSE → 结果、进度、同步回退、历史.

import { NavigationContainer } from "@react-navigation/native";
import { fireEvent, render, screen, waitFor, act } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";
import React from "react";

import type { SearchAPI } from "@/api/search";
import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { initI18n } from "@/i18n";
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

async function renderScreen(api: SearchAPI, initialQuery?: string) {
  resetMMKV();
  const i18n = await initI18n("en");
  return render(
    <NavigationContainer>
      <I18nextProvider i18n={i18n}>
        <ThemeProvider override="light">
          <SearchScreenContext.Provider value={{ api, serverURL: "https://api.test" }}>
            <SearchScreen route={{ key: "k", name: "Search", params: initialQuery ? { initialQuery } : undefined }} />
          </SearchScreenContext.Provider>
        </ThemeProvider>
      </I18nextProvider>
    </NavigationContainer>,
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
    expect(screen.getByText("Search history")).toBeTruthy();
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
});
