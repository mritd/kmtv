/**
 * kinds tests cover per-kind coercion of untrusted payloads, keys, caps, and favorite mapping.
 *
 * kinds 测试覆盖各数据类型对不可信 payload 的规整, key, 上限和收藏映射.
 */
import { describe, expect, it } from "vitest";

import { favoriteFromSearchResult, syncAdapter } from "./kinds";

describe("syncAdapter", () => {
  it("keys watch and favorite records by title and search records by query", () => {
    expect(syncAdapter("watch").keyOf(syncAdapter("watch").coerce({ title: " Demo  Show " }))).toBe("demo show");
    expect(syncAdapter("favorite").keyOf(syncAdapter("favorite").coerce({ title: "Show X" }))).toBe("show x");
    expect(syncAdapter("search").keyOf(syncAdapter("search").coerce({ query: "Alpha" }))).toBe("alpha");
  });

  it("coerces malformed wire payloads into well-formed records", () => {
    expect(
      syncAdapter("watch").coerce({
        title: 7,
        cover: null,
        source_key: " s1 ",
        group_index: -2,
        episode_index: 2.7,
        progress_sec: "12",
        duration_sec: Number.NaN,
        completed: "yes",
      }),
    ).toEqual({
      title: "",
      cover: "",
      source_key: "s1",
      video_id: "",
      episode: "",
      group_index: 0,
      episode_index: 2,
      progress_sec: 0,
      duration_sec: 0,
      completed: false,
    });
    expect(syncAdapter("favorite").coerce(null)).toEqual({
      title: "",
      cover: "",
      type: "",
      year: "",
      rate: "",
      desc: "",
      source_key: "",
      video_id: "",
    });
    expect(syncAdapter("search").coerce({ query: ["x"] })).toEqual({ query: "" });
  });

  it("cuts text fields to the server limits by code point", () => {
    const emoji = "\u{1F600}";
    const favorite = syncAdapter("favorite").coerce({ title: emoji.repeat(600), year: "9".repeat(70), desc: "d".repeat(3000) });
    expect([...favorite.title]).toHaveLength(512);
    expect(favorite.year).toHaveLength(64);
    expect(favorite.desc).toHaveLength(2048);
    expect(syncAdapter("watch").coerce({ cover: "c".repeat(9000) }).cover).toHaveLength(8192);
    expect(syncAdapter("search").coerce({ query: `${"q".repeat(511)} tail` }).query).toBe("q".repeat(511));
  });

  it("exposes the spec caps", () => {
    expect(syncAdapter("watch").cap).toBe(200);
    expect(syncAdapter("favorite").cap).toBeNull();
    expect(syncAdapter("search").cap).toBe(50);
  });
});

describe("favoriteFromSearchResult", () => {
  it("copies display fields and the first source", () => {
    expect(
      favoriteFromSearchResult({
        title: "Show X",
        type: "Drama",
        year: "2025",
        cover: "https://img.example/x.jpg",
        desc: "Desc",
        rate: "8.1",
        sources: [
          { source_key: "a", video_id: "1" },
          { source_key: "b", video_id: "2" },
        ],
      }),
    ).toEqual({
      title: "Show X",
      cover: "https://img.example/x.jpg",
      type: "Drama",
      year: "2025",
      rate: "8.1",
      desc: "Desc",
      source_key: "a",
      video_id: "1",
    });
  });
});
