import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { APIProvider } from "@/api/context";
import type { DoubanHomeSection } from "@/api/types";
import { favoritesKey, makeFavorite, type FavoriteItem } from "@/storage/favorites";
import { createTestAPI } from "@/test/testAPI";

import { FavoritesPage } from "./FavoritesPage";

const favorite: FavoriteItem = {
  title: "Slam Dunk",
  type: "Anime",
  year: "1993",
  cover: "https://img.example/slam-dunk.jpg",
  desc: "Basketball story",
  rate: "8.7",
  source: { source_key: "source-a", source_name: "Source A", video_id: "video-1" },
};

function renderFavorites(sections: DoubanHomeSection[] = []) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

  render(
    <APIProvider value={createTestAPI({ doubanHome: async () => ({ sections }) })}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={["/favorites"]}>
          <Routes>
            <Route path="/favorites" element={<FavoritesPage />} />
            <Route path="/search" element={<LocationProbe />} />
            <Route path="/detail/:token" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </APIProvider>,
  );
}

function LocationProbe() {
  const location = useLocation();
  return <div aria-label="Current path">{`${location.pathname}${location.search}`}</div>;
}

afterEach(() => {
  window.localStorage.clear();
});

describe("FavoritesPage", () => {
  it("preserves the search result rating when creating a favorite", () => {
    const item = makeFavorite(
      {
        title: "Rated Search Result",
        type: "Movie",
        year: "2026",
        cover: "",
        desc: "Rated result",
        rate: "8.9",
        sources: [{ source_key: "source-a", source_name: "Source A", video_id: "video-1" }],
      },
      { source_key: "source-a", source_name: "Source A", video_id: "video-1" },
    );

    expect(item.rate).toBe("8.9");
  });

  it("shows the saved rating on the favorite poster badge", () => {
    window.localStorage.setItem(favoritesKey, JSON.stringify([favorite]));

    renderFavorites();

    const card = screen.getByRole("article", { name: "Slam Dunk" });
    expect(within(card).getByText("8.7")).toHaveClass("poster-rating-badge");
  });

  it("uses the matching home rating when an older favorite has no saved rating", async () => {
    window.localStorage.setItem(favoritesKey, JSON.stringify([{ ...favorite, rate: undefined }]));

    renderFavorites([{ name: "热门", items: [{ id: "home-1", title: "Slam Dunk", rate: "9.1" }] }]);

    const card = screen.getByRole("article", { name: "Slam Dunk" });
    await waitFor(() => expect(within(card).getByText("9.1")).toHaveClass("poster-rating-badge"));
    expect(within(card).queryByText("N/A")).toBeNull();
  });

  it("shows N/A on favorite poster badges when rating is unavailable", () => {
    window.localStorage.setItem(
      favoritesKey,
      JSON.stringify([
        { ...favorite, title: "Zero Rating", rate: "0", source: { ...favorite.source, video_id: "video-2" } },
        { ...favorite, title: "Missing Rating", rate: undefined, source: { ...favorite.source, video_id: "video-3" } },
      ]),
    );

    renderFavorites();

    expect(within(screen.getByRole("article", { name: "Zero Rating" })).getByText("N/A")).toHaveClass("poster-rating-badge");
    expect(within(screen.getByRole("article", { name: "Missing Rating" })).getByText("N/A")).toHaveClass("poster-rating-badge");
  });

  it("uses concise favorite card actions without redundant metadata", async () => {
    window.localStorage.setItem(favoritesKey, JSON.stringify([favorite]));

    renderFavorites();

    const card = screen.getByRole("article", { name: "Slam Dunk" });
    expect(within(card).getByRole("button", { name: "搜索播放" })).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "取消收藏" })).toHaveClass("ui-button-danger");
    expect(within(card).queryByText("收藏影片")).toBeNull();
  });

  it("searches by title instead of opening the saved source directly", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(favoritesKey, JSON.stringify([favorite]));

    renderFavorites();

    expect(screen.getByRole("heading", { name: "Slam Dunk" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "播放" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "搜索播放" }));

    expect(screen.getByLabelText("Current path")).toHaveTextContent("/search?q=Slam+Dunk");
  });

  it("removes a favorite without navigating", async () => {
    const user = userEvent.setup();
    window.localStorage.setItem(favoritesKey, JSON.stringify([favorite]));

    renderFavorites();

    await user.click(screen.getByRole("button", { name: "取消收藏" }));

    expect(screen.queryByRole("heading", { name: "Slam Dunk" })).toBeNull();
    expect(window.localStorage.getItem(favoritesKey)).not.toContain("Slam Dunk");
  });
});
