/**
 * FavoritesPage tests cover rating badges, search navigation, and removal through the sync store.
 *
 * FavoritesPage 测试覆盖评分徽标, 搜索跳转以及通过同步存储删除收藏.
 */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { APIProvider } from "@/api/context";
import type { DoubanHomeSection } from "@/api/types";
import { SyncValueProvider } from "@/sync/SyncContext";
import type { SyncStore } from "@/sync/syncStore";
import type { FavoritePayload } from "@/sync/types";
import { openSyncStore } from "@/test/syncFixtures";
import { createTestAPI } from "@/test/testAPI";

import { FavoritesPage } from "./FavoritesPage";

const favorite: FavoritePayload = {
  title: "Slam Dunk",
  type: "Anime",
  year: "1993",
  cover: "https://img.example/slam-dunk.jpg",
  desc: "Basketball story",
  rate: "8.7",
  source_key: "source-a",
  video_id: "video-1",
};

function renderFavorites(store: SyncStore, sections: DoubanHomeSection[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <APIProvider value={createTestAPI({ doubanHome: async () => ({ sections }) })}>
      <QueryClientProvider client={queryClient}>
        <SyncValueProvider value={{ status: "ready", store, engine: null }}>
          <MemoryRouter initialEntries={["/favorites"]}>
            <Routes>
              <Route path="/favorites" element={<FavoritesPage />} />
              <Route path="/search" element={<LocationProbe />} />
            </Routes>
          </MemoryRouter>
        </SyncValueProvider>
      </QueryClientProvider>
    </APIProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div aria-label="Current path">{`${location.pathname}${location.search}`}</div>;
}

function storeWith(...items: FavoritePayload[]): SyncStore {
  const store = openSyncStore(0, "");
  for (const item of items) store.upsert("favorite", item);
  return store;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("FavoritesPage", () => {
  it("shows the saved rating on the favorite poster badge", () => {
    renderFavorites(storeWith(favorite));
    const card = screen.getByRole("article", { name: "Slam Dunk" });
    expect(within(card).getByText("8.7")).toHaveClass("poster-rating-badge");
  });

  it("uses the matching home rating when a favorite has no saved rating", async () => {
    renderFavorites(storeWith({ ...favorite, rate: "" }), [{ name: "热门", items: [{ id: "home-1", title: "Slam Dunk", rate: "9.1" }] }]);
    const card = screen.getByRole("article", { name: "Slam Dunk" });
    await waitFor(() => expect(within(card).getByText("9.1")).toHaveClass("poster-rating-badge"));
  });

  it("shows N/A on favorite poster badges when rating is unavailable", () => {
    renderFavorites(storeWith({ ...favorite, title: "Zero Rating", rate: "0" }, { ...favorite, title: "Missing Rating", rate: "" }));
    expect(within(screen.getByRole("article", { name: "Zero Rating" })).getByText("N/A")).toHaveClass("poster-rating-badge");
    expect(within(screen.getByRole("article", { name: "Missing Rating" })).getByText("N/A")).toHaveClass("poster-rating-badge");
  });

  it("uses concise favorite card actions", () => {
    renderFavorites(storeWith(favorite));
    const card = screen.getByRole("article", { name: "Slam Dunk" });
    expect(within(card).getByRole("button", { name: "搜索播放" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "取消收藏" })).toHaveClass("ui-button-danger");
  });

  it("searches by title instead of opening the saved source directly", async () => {
    const user = userEvent.setup();
    renderFavorites(storeWith(favorite));
    await user.click(screen.getByRole("button", { name: "搜索播放" }));
    expect(screen.getByLabelText("Current path")).toHaveTextContent("/search?q=Slam+Dunk");
  });

  it("removes a favorite through the sync store without navigating", async () => {
    const user = userEvent.setup();
    const store = storeWith(favorite);
    renderFavorites(store);
    await user.click(screen.getByRole("button", { name: "取消收藏" }));
    expect(screen.queryByRole("heading", { name: "Slam Dunk" })).toBeNull();
    expect(store.state().records["favorite|slam dunk"]).toMatchObject({ deleted: true, dirty: true });
  });

  it("lists favorites newest first", () => {
    let now = 1_790_000_000_000;
    const spy = vi.spyOn(Date, "now").mockImplementation(() => (now += 1_000));
    const store = storeWith({ ...favorite, title: "Older" }, { ...favorite, title: "Newer" });
    spy.mockRestore();
    renderFavorites(store);
    const titles = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(titles).toEqual(["Newer", "Older"]);
  });
});
