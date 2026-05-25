/**
 * favorites.test.ts — unit tests for the favorites storage module.
 * Tests cover: add/remove, list, clear, localStorage round-trip, malformed JSON guard,
 * multi-source idempotency, and all exported ID helpers.
 *
 * favorites.test.ts — 收藏存储模块的单元测试.
 * 测试涵盖: 添加/移除、列表、清空、localStorage 往返、损坏 JSON 保护、
 * 多源幂等性, 以及所有导出的 ID 辅助函数.
 */
import { beforeEach, describe, expect, it } from "vitest";

import type { SearchResult, SourceResult } from "@/api/types";

import {
  favoriteID,
  favoriteIDs,
  favoritesKey,
  isFavoriteResult,
  isFavoriteSource,
  listFavorites,
  makeFavorite,
  mediaFavoriteID,
  resultFavoriteIDs,
  sourceFavoriteID,
  toggleFavorite,
  toggleResultFavorite,
} from "./favorites";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const sourceA: SourceResult = {
  source_key: "iptv",
  source_name: "IPTV",
  video_id: "v001",
};

const sourceB: SourceResult = {
  source_key: "stream",
  source_name: "Stream",
  video_id: "v002",
};

const resultWithTwo: SearchResult = {
  title: "Demo Show",
  year: "2025",
  type: "Drama",
  cover: "cover.jpg",
  desc: "A demo show",
  rate: "9.0",
  sources: [sourceA, sourceB],
};

const resultSingleSource: SearchResult = {
  title: "Solo Film",
  year: "2024",
  sources: [sourceA],
};

beforeEach(() => {
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------
// favoriteID / sourceFavoriteID / mediaFavoriteID / resultFavoriteIDs
// ---------------------------------------------------------------------------

describe("ID helpers", () => {
  it("favoriteID returns <source_key>:<video_id>", () => {
    const item = makeFavorite(resultSingleSource, sourceA);
    expect(favoriteID(item)).toBe("iptv:v001");
  });

  it("sourceFavoriteID returns same format as favoriteID", () => {
    expect(sourceFavoriteID(sourceA)).toBe("iptv:v001");
  });

  it("mediaFavoriteID is case-insensitive and trims whitespace", () => {
    expect(mediaFavoriteID({ title: "  Demo Show  ", year: " 2025 " })).toBe("demo show:2025");
    expect(mediaFavoriteID({ title: "DEMO SHOW", year: "2025" })).toBe("demo show:2025");
  });

  it("mediaFavoriteID handles missing year", () => {
    expect(mediaFavoriteID({ title: "No Year" })).toBe("no year:");
  });

  it("resultFavoriteIDs includes mediaID and all source IDs", () => {
    const ids = resultFavoriteIDs(resultWithTwo);
    expect(ids.has("demo show:2025")).toBe(true);
    expect(ids.has("iptv:v001")).toBe(true);
    expect(ids.has("stream:v002")).toBe(true);
    expect(ids.size).toBe(3);
  });

  it("resultFavoriteIDs works when sources is an empty array", () => {
    const ids = resultFavoriteIDs({ title: "Empty", sources: [] });
    // Only the media ID is present when there are no sources.
    // 无 source 时只有 mediaID.
    expect(ids.has("empty:")).toBe(true);
    expect(ids.size).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// makeFavorite
// ---------------------------------------------------------------------------

describe("makeFavorite", () => {
  it("copies all optional fields from the search result", () => {
    const item = makeFavorite(resultWithTwo, sourceB);
    expect(item).toMatchObject({
      title: "Demo Show",
      year: "2025",
      type: "Drama",
      cover: "cover.jpg",
      desc: "A demo show",
      rate: "9.0",
      source: sourceB,
    });
  });

  it("accepts a result with no optional fields", () => {
    const sparse: SearchResult = { title: "Sparse", sources: [sourceA] };
    const item = makeFavorite(sparse, sourceA);
    expect(item.title).toBe("Sparse");
    expect(item.type).toBeUndefined();
    expect(item.year).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// listFavorites / favoriteIDs
// ---------------------------------------------------------------------------

describe("listFavorites", () => {
  it("returns empty array when storage is empty", () => {
    expect(listFavorites()).toEqual([]);
  });

  it("returns items written to localStorage by toggleFavorite", () => {
    const item = makeFavorite(resultSingleSource, sourceA);
    toggleFavorite(item);
    expect(listFavorites()).toHaveLength(1);
    expect(listFavorites()[0]?.title).toBe("Solo Film");
  });
});

describe("favoriteIDs", () => {
  it("returns an empty Set when no favorites exist", () => {
    expect(favoriteIDs().size).toBe(0);
  });

  it("contains both source ID and media ID for each stored item", () => {
    toggleFavorite(makeFavorite(resultSingleSource, sourceA));
    const ids = favoriteIDs();
    expect(ids.has("iptv:v001")).toBe(true);
    expect(ids.has("solo film:2024")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// isFavoriteSource / isFavoriteResult
// ---------------------------------------------------------------------------

describe("isFavoriteSource", () => {
  it("returns false when no favorites exist", () => {
    expect(isFavoriteSource(sourceA)).toBe(false);
  });

  it("returns true after the source is favorited", () => {
    toggleFavorite(makeFavorite(resultSingleSource, sourceA));
    expect(isFavoriteSource(sourceA)).toBe(true);
  });

  it("returns false for a different source", () => {
    toggleFavorite(makeFavorite(resultSingleSource, sourceA));
    expect(isFavoriteSource(sourceB)).toBe(false);
  });
});

describe("isFavoriteResult", () => {
  it("returns false when no favorites exist", () => {
    expect(isFavoriteResult(resultWithTwo)).toBe(false);
  });

  it("returns true when any source of the result is favorited", () => {
    // Favorite only via sourceB; isFavoriteResult should still match via source ID.
    // 仅收藏 sourceB; isFavoriteResult 应通过 source ID 匹配.
    toggleFavorite(makeFavorite(resultWithTwo, sourceB));
    expect(isFavoriteResult(resultWithTwo)).toBe(true);
  });

  it("returns true when the media title+year matches a stored item", () => {
    // Favorite with sourceA; then check the same title via a different source list shape.
    // 通过 sourceA 收藏; 再以不同 source 列表检查同一标题.
    toggleFavorite(makeFavorite(resultWithTwo, sourceA));
    const sameMedia: SearchResult = {
      title: "Demo Show",
      year: "2025",
      sources: [{ source_key: "other", source_name: "Other", video_id: "v999" }],
    };
    expect(isFavoriteResult(sameMedia)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// toggleFavorite (single-item toggle)
// ---------------------------------------------------------------------------

describe("toggleFavorite", () => {
  it("adds an item when it is not yet favorited", () => {
    const item = makeFavorite(resultSingleSource, sourceA);
    const result = toggleFavorite(item);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ title: "Solo Film" });
  });

  it("removes an item when it is already favorited", () => {
    const item = makeFavorite(resultSingleSource, sourceA);
    toggleFavorite(item);
    const result = toggleFavorite(item);
    expect(result).toHaveLength(0);
  });

  it("prepends new favorites to the list", () => {
    const itemA = makeFavorite(resultSingleSource, sourceA);
    const itemB = makeFavorite(resultWithTwo, sourceB);
    toggleFavorite(itemA);
    toggleFavorite(itemB);
    expect(listFavorites()[0]?.title).toBe("Demo Show");
    expect(listFavorites()[1]?.title).toBe("Solo Film");
  });

  it("add then remove (double-toggle) leaves the list empty", () => {
    const item = makeFavorite(resultSingleSource, sourceA);
    toggleFavorite(item);
    toggleFavorite(item);
    expect(listFavorites()).toHaveLength(0);
  });

  it("persists to localStorage and survives a read-back (round-trip)", () => {
    const item = makeFavorite(resultWithTwo, sourceA);
    toggleFavorite(item);

    // Simulate a re-read by calling listFavorites (reads from localStorage).
    // 通过 listFavorites 模拟重新读取 (从 localStorage 读取).
    const persisted = listFavorites();
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.source.source_key).toBe("iptv");
    expect(persisted[0]?.source.video_id).toBe("v001");
  });
});

// ---------------------------------------------------------------------------
// toggleResultFavorite (whole-result toggle via first source)
// ---------------------------------------------------------------------------

describe("toggleResultFavorite", () => {
  it("adds a favorite using the first source", () => {
    const items = toggleResultFavorite(resultWithTwo);
    expect(items).toHaveLength(1);
    expect(items[0]?.source.source_key).toBe("iptv");
  });

  it("removes all entries matching this result on second toggle", () => {
    toggleResultFavorite(resultWithTwo);
    const after = toggleResultFavorite(resultWithTwo);
    expect(after).toHaveLength(0);
  });

  it("does nothing and returns existing list when result has no sources", () => {
    const empty: SearchResult = { title: "No Source", sources: [] };
    const before = listFavorites();
    const result = toggleResultFavorite(empty);
    expect(result).toEqual(before);
    expect(listFavorites()).toHaveLength(0);
  });

  it("removes by media ID — catches items added via a different source", () => {
    // Add an item via sourceA, then toggle the whole result (which uses both sources for matching).
    // 通过 sourceA 添加收藏, 再切换整个结果 (匹配两个 source).
    toggleFavorite(makeFavorite(resultWithTwo, sourceA));
    expect(listFavorites()).toHaveLength(1);
    toggleResultFavorite(resultWithTwo);
    expect(listFavorites()).toHaveLength(0);
  });

  it("multi-source: adds once even when result has multiple sources (idempotent)", () => {
    toggleResultFavorite(resultWithTwo);
    // Should have exactly 1 item, not 2 (one per source).
    // 只应添加 1 条, 而非每个 source 各一条.
    expect(listFavorites()).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// localStorage round-trip & malformed JSON guard
// ---------------------------------------------------------------------------

describe("localStorage round-trip and corruption guard", () => {
  it("reads back the same data written by toggleFavorite", () => {
    const item = makeFavorite(resultWithTwo, sourceA);
    toggleFavorite(item);

    const raw = window.localStorage.getItem(favoritesKey);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!) as unknown[];
    expect(parsed).toHaveLength(1);
  });

  it("returns [] and clears the key when localStorage contains corrupt JSON", () => {
    window.localStorage.setItem(favoritesKey, "not valid JSON {");
    const items = listFavorites();
    expect(items).toEqual([]);
    // After a corruption guard triggers, the corrupt entry is removed.
    // 损坏 JSON 触发防护后, 条目被清除.
    expect(window.localStorage.getItem(favoritesKey)).toBeNull();
  });

  it("returns [] when the key is absent", () => {
    expect(listFavorites()).toEqual([]);
  });

  it("returns [] and clears the key when localStorage contains a non-array JSON value", () => {
    // A non-array value like {} would cause .some()/.filter() to crash on the returned value.
    // 非数组值如 {} 会导致下游的 .some()/.filter() 崩溃.
    window.localStorage.setItem(favoritesKey, JSON.stringify({ bad: true }));
    expect(listFavorites()).toEqual([]);
    expect(window.localStorage.getItem(favoritesKey)).toBeNull();
  });

  it("returns [] and clears the key when localStorage contains a JSON scalar", () => {
    window.localStorage.setItem(favoritesKey, JSON.stringify(42));
    expect(listFavorites()).toEqual([]);
    expect(window.localStorage.getItem(favoritesKey)).toBeNull();
  });
});
