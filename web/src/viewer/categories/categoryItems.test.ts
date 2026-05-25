/**
 * Tests for categoryItems — page flattening + dedup.
 * categoryItems 测试 — 分页扁平化 + 去重.
 */

import { describe, expect, it } from "vitest";

import type { DoubanItem } from "@/api/types";
import { flattenCategoryPages } from "./categoryItems";

const item = (id: string): DoubanItem => ({ id, title: `T${id}` });

describe("flattenCategoryPages", () => {
  it("returns an empty array when pages is undefined", () => {
    expect(flattenCategoryPages(undefined)).toEqual([]);
  });

  it("concatenates items across pages in order", () => {
    const result = flattenCategoryPages([{ items: [item("1"), item("2")] }, { items: [item("3")] }]);
    expect(result.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("removes duplicates that overlap across pages, keeping the first occurrence", () => {
    const result = flattenCategoryPages([
      { items: [item("1"), item("2")] },
      { items: [item("2"), item("3")] },
    ]);
    expect(result.map((i) => i.id)).toEqual(["1", "2", "3"]);
  });

  it("handles empty pages", () => {
    expect(flattenCategoryPages([{ items: [] }, { items: [] }])).toEqual([]);
  });
});
