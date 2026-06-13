// MMKV-backed favorites storage tests.
// MMKV 收藏存储测试.

import { _resetForTests } from "./mmkv";
import {
  addFavorite, isFavorited, listFavorites, removeFavorite, toggleFavorite,
  type FavoriteItem,
} from "./favorites";

describe("favorites storage", () => {
  const server = "http://localhost:8080";
  beforeEach(() => { _resetForTests(); });

  function mk(over: Partial<FavoriteItem> = {}): Omit<FavoriteItem, "addedAt"> {
    return { sourceKey: "s1", videoId: "v1", title: "Title", cover: "/c.jpg", type: "Movie", year: "2026", ...over };
  }

  it("isFavorited is false before adding", () => {
    expect(isFavorited(server, "s1", "v1")).toBe(false);
  });
  it("addFavorite then isFavorited is true", () => {
    addFavorite(server, mk());
    expect(isFavorited(server, "s1", "v1")).toBe(true);
  });
  it("listFavorites returns newest first", () => {
    addFavorite(server, mk({ title: "A" }));
    addFavorite(server, mk({ videoId: "v2", title: "B" }));
    const list = listFavorites(server);
    expect(list.map((f) => f.title)).toEqual(["B", "A"]);
  });
  it("removeFavorite removes the matching (sourceKey, videoId)", () => {
    addFavorite(server, mk());
    removeFavorite(server, "s1", "v1");
    expect(isFavorited(server, "s1", "v1")).toBe(false);
  });
  it("toggleFavorite flips state and returns the new value", () => {
    expect(toggleFavorite(server, mk())).toBe(true);
    expect(toggleFavorite(server, mk())).toBe(false);
  });
  it("isolates between servers", () => {
    addFavorite(server, mk());
    expect(isFavorited("http://other", "s1", "v1")).toBe(false);
  });
  it("addFavorite is a no-op when the tuple already exists", () => {
    addFavorite(server, mk());
    addFavorite(server, mk({ title: "Different" }));
    expect(listFavorites(server)).toHaveLength(1);
  });
  it("removeFavorite is a no-op when the tuple is absent", () => {
    addFavorite(server, mk());
    removeFavorite(server, "missing", "missing");
    expect(listFavorites(server)).toHaveLength(1);
  });
});
