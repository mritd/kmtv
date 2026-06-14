// Integration test for HomeScreen: loading, success, error inline render.
// HomeScreen 集成测试: loading、success、错误内联显示.

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, waitFor } from "@testing-library/react-native";
import React from "react";

import type { DoubanAPI } from "@/api/douban";
import type { DoubanHomeResponse } from "@/api/types";
import { ThemeProvider } from "@/designSystem/ThemeProvider";
import { ToastProvider } from "@/designSystem/Toast";
import { initI18n } from "@/i18n";
import { useServerStore } from "@/store/serverStore";

import { HomeScreen, HomeScreenContext } from "./HomeScreen";

// First section has 6 items to exercise heroItems.slice(0, 5), second section has unrelated
// items to verify the carousel only pulls from the first section.
// 第一个 section 含 6 项以覆盖 heroItems.slice(0, 5), 第二个 section 含无关项以验证轮播
// 只从第一个 section 取数.
const payload: DoubanHomeResponse = {
  sections: [
    {
      name: "热门",
      tag: "hot",
      type: "movie",
      items: [
        { id: "h1", title: "Hero1", cover: "/1.jpg", rate: "8.4", year: "2024" },
        { id: "h2", title: "Hero2", cover: "/2.jpg", rate: "8.4", year: "2024" },
        { id: "h3", title: "Hero3", cover: "/3.jpg", rate: "8.4", year: "2024" },
        { id: "h4", title: "Hero4", cover: "/4.jpg", rate: "8.4", year: "2024" },
        { id: "h5", title: "Hero5", cover: "/5.jpg", rate: "8.4", year: "2024" },
        { id: "h6", title: "SixthShouldNotAppearInHero", cover: "/6.jpg", rate: "8.4", year: "2024" },
      ],
    },
    {
      name: "新片",
      tag: "new",
      type: "movie",
      items: [{ id: "n1", title: "OnlyInNewSection", cover: "/c.jpg", rate: "7.5", year: "2024" }],
    },
  ],
};

function makeWrapper(
  api: DoubanAPI,
  callbacks: { onSearch?: () => void; onSelectTitle?: (title: string) => void } = {},
) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  // eslint-disable-next-line react/display-name
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={qc}>
      <ThemeProvider override="system">
        <ToastProvider>
          <HomeScreenContext.Provider value={{ api, ...callbacks }}>
            {children}
          </HomeScreenContext.Provider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

beforeAll(async () => {
  await initI18n("en");
});

beforeEach(() => {
  useServerStore.setState({ serverURL: "https://x" });
});

describe("HomeScreen", () => {
  it("shows loading state then sections, capping hero items to 5", async () => {
    let resolve!: (v: DoubanHomeResponse) => void;
    const api: DoubanAPI = {
      doubanHome: jest.fn(() => new Promise<DoubanHomeResponse>((r) => { resolve = r; })),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(),
    };
    const { getByTestId, queryAllByTestId, queryByText } = render(<HomeScreen />, { wrapper: makeWrapper(api) });
    expect(getByTestId("homeLoading")).toBeTruthy();
    expect(queryByText("热门")).toBeNull();
    resolve(payload);
    await waitFor(() => expect(queryByText("热门")).not.toBeNull());
    expect(queryByText("新片")).not.toBeNull();
    // Hero carousel renders exactly 5 slides (heroItems.slice(0, 5)). The 6th item of the
    // first section appears via SectionRow but never inside the hero region.
    // hero 轮播渲染恰好 5 张 (heroItems.slice(0, 5)). 第一个 section 的第 6 项通过
    // SectionRow 出现, 不应出现在 hero 区域.
    expect(queryAllByTestId("heroSlide")).toHaveLength(5);
    // The second section's only item appears as a SectionRow VideoCard.
    // 第二个 section 的唯一项作为 SectionRow 的 VideoCard 出现.
    expect(queryByText("OnlyInNewSection")).not.toBeNull();
  });

  it("renders inline error when load fails", async () => {
    const api: DoubanAPI = {
      doubanHome: jest.fn(async () => { throw { kind: "server", message: "boom" }; }),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(),
    };
    const { findByText } = render(<HomeScreen />, { wrapper: makeWrapper(api) });
    await findByText(/Could not load home feed/);
  });

  it("invokes onSearch when the top-bar search button is tapped", async () => {
    const onSearch = jest.fn();
    const api: DoubanAPI = {
      doubanHome: jest.fn(async () => payload),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(),
    };
    const { findByTestId } = render(<HomeScreen />, { wrapper: makeWrapper(api, { onSearch }) });
    const btn = await findByTestId("homeSearchButton");
    fireEvent.press(btn);
    expect(onSearch).toHaveBeenCalledTimes(1);
  });

  it("invokes onSelectTitle with the tapped card's title", async () => {
    const onSelectTitle = jest.fn();
    const api: DoubanAPI = {
      doubanHome: jest.fn(async () => payload),
      doubanCategories: jest.fn(),
      doubanRecommendFilter: jest.fn(),
    };
    const { findByText } = render(<HomeScreen />, { wrapper: makeWrapper(api, { onSelectTitle }) });
    const card = await findByText("OnlyInNewSection");
    fireEvent.press(card);
    expect(onSelectTitle).toHaveBeenCalledWith("OnlyInNewSection");
  });
});
