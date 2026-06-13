// flattenCategoryPages pure-function tests.
// flattenCategoryPages 纯函数测试.

import type { DoubanListResponse } from "@/api/types";

import { flattenCategoryPages } from "./categoryItems";

const item = (id: string, title: string = id) => ({ id, title, cover: "", rate: "", year: "" });

describe("flattenCategoryPages", () => {
  it("returns [] when pages is undefined", () => {
    expect(flattenCategoryPages(undefined)).toEqual([]);
  });

  it("returns [] when pages is empty", () => {
    expect(flattenCategoryPages([])).toEqual([]);
  });

  it("concatenates non-overlapping pages preserving order", () => {
    const pages: DoubanListResponse[] = [
      { items: [item("a"), item("b")] },
      { items: [item("c")] },
    ];
    expect(flattenCategoryPages(pages).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("dedups by id keeping first occurrence", () => {
    const pages: DoubanListResponse[] = [
      { items: [item("a"), item("b")] },
      { items: [item("b"), item("c")] },
      { items: [item("a"), item("d")] },
    ];
    expect(flattenCategoryPages(pages).map((i) => i.id)).toEqual(["a", "b", "c", "d"]);
  });
});
