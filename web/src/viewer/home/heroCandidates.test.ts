/**
 * heroCandidates.test.ts — unit tests for the selectHeroCandidates pure helper.
 * heroCandidates.test.ts — selectHeroCandidates 纯函数的单元测试.
 *
 * Strategy / 策略:
 *   All tests are fully deterministic: the random() function is injected and controlled
 *   per test, so shuffle results are predictable without relying on Math.random.
 *   所有测试完全确定: 每个测试注入并控制 random() 函数, shuffle 结果可预测, 无需依赖 Math.random.
 *
 * Branches covered / 覆盖分支:
 *   1. Empty sections list — returns [].
 *      空分区列表 — 返回 [].
 *   2. Single item with description — returns that one candidate.
 *      单条有描述条目 — 返回该候选项.
 *   3. Multiple items across sections — flattens and keeps sectionName.
 *      多分区多条目 — 展平并保留 sectionName.
 *   4. Deduplication by id — same id across sections, first one wins.
 *      按 id 去重 — 多分区同 id, 第一个保留.
 *   5. Deduplication by title — blank id falls back to title.
 *      按 title 去重 — 空 id 退回 title.
 *   6. Items without description excluded — missing desc, blank desc.
 *      无描述条目被排除 — 缺失 desc, 空白 desc.
 *   7. Items without title excluded — blank title.
 *      无标题条目被排除 — 空白 title.
 *   8. Shuffle re-orders results according to the random source.
 *      shuffle 按 random 源重排结果.
 *   9. limit param caps the returned count.
 *      limit 参数限制返回数量.
 *  10. Zero limit — returns [].
 *      limit 为 0 — 返回 [].
 *  11. Limit larger than candidates count — returns all.
 *      limit 超过候选数量 — 返回全部.
 *  12. Candidate key uses id when id is non-blank.
 *      候选 key 使用非空 id.
 *  13. Candidate key uses trimmed title when id is blank.
 *      id 为空时候选 key 使用 trim 后的 title.
 *  14. Only whitespace id treated as blank — deduplication uses title.
 *      仅含空格的 id 视为空 — 去重使用 title.
 */

import { describe, expect, it } from "vitest";

import type { DoubanHomeSection } from "@/api/types";

import { selectHeroCandidates } from "./heroCandidates";

// ---------------------------------------------------------------------------
// Helpers
// 辅助函数
// ---------------------------------------------------------------------------

function section(name: string, ids: string[]): DoubanHomeSection {
  return {
    name,
    items: ids.map((id) => ({ id, title: `Title ${id}`, cover: `/cover-${id}.jpg`, year: "2026", desc: `Description ${id}` })),
  };
}

// always() returns the same value for every shuffle call — fully predictable ordering.
// always() 每次 shuffle 调用返回相同值 — 排序完全可预测.
const alwaysHigh = () => 0.99; // minimal swap — roughly preserves insertion order
const alwaysZero = () => 0;     // maximal swap — reverses insertion order at each step

// ---------------------------------------------------------------------------
// Tests
// 测试用例
// ---------------------------------------------------------------------------

describe("selectHeroCandidates", () => {
  // ---- 1: empty input ----
  it("returns an empty array when sections is empty", () => {
    expect(selectHeroCandidates([], 6, alwaysHigh)).toEqual([]);
  });

  // ---- 2: single item with description ----
  it("returns the single qualifying candidate when only one item exists", () => {
    const candidates = selectHeroCandidates(
      [{ name: "热门电影", items: [{ id: "a1", title: "Movie A", desc: "Great film" }] }],
      6,
      alwaysHigh,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].item.id).toBe("a1");
    expect(candidates[0].sectionName).toBe("热门电影");
  });

  // ---- 3: multiple sections flattened with correct sectionName ----
  it("flattens all home sections and keeps each section name", () => {
    const candidates = selectHeroCandidates([section("热门电影", ["a"]), section("热门剧集", ["b"])], 6, alwaysHigh);

    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.sectionName)).toEqual(["热门电影", "热门剧集"]);
    expect(candidates.map((candidate) => candidate.item.title)).toEqual(["Title a", "Title b"]);
  });

  // ---- 4: deduplication by id (same id across sections) ----
  it("deduplicates by id before title", () => {
    const candidates = selectHeroCandidates(
      [
        {
          name: "热门电影",
          items: [
            { id: "same", title: "Movie", desc: "Movie description" },
            { id: "", title: "Untitled Pick", desc: "Untitled description" },
          ],
        },
        {
          name: "热门剧集",
          items: [
            { id: "same", title: "Series", desc: "Series description" },
            { id: "", title: "Untitled Pick", desc: "Untitled duplicate description" },
          ],
        },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates.map((candidate) => candidate.item.id)).toEqual(["same", ""]);
    expect(candidates.map((candidate) => candidate.sectionName)).toEqual(["热门电影", "热门电影"]);
  });

  // ---- 5: deduplication by title when id is blank ----
  it("deduplicates by title when id is blank across sections", () => {
    const candidates = selectHeroCandidates(
      [
        { name: "热门电影", items: [{ id: "", title: "Shared Title", desc: "First occurrence" }] },
        { name: "热门剧集", items: [{ id: "", title: "Shared Title", desc: "Second occurrence" }] },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].sectionName).toBe("热门电影");
  });

  // ---- 6a: item missing desc is excluded ----
  it("excludes items without a desc field", () => {
    const candidates = selectHeroCandidates(
      [{ name: "热门电影", items: [{ id: "no-desc", title: "No Desc" }] }],
      6,
      alwaysHigh,
    );

    expect(candidates).toHaveLength(0);
  });

  // ---- 6b: item with blank desc is excluded ----
  it("excludes items whose desc is blank or whitespace-only", () => {
    const candidates = selectHeroCandidates(
      [
        {
          name: "热门电影",
          items: [
            { id: "blank", title: "Blank Desc", desc: "   " },
            { id: "described", title: "Described", desc: "Real description" },
          ],
        },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates.map((candidate) => candidate.item.id)).toEqual(["described"]);
  });

  // ---- 6c: full exclusion table from original test ----
  it("excludes items without a usable description", () => {
    const candidates = selectHeroCandidates(
      [
        {
          name: "热门电影",
          items: [
            { id: "missing", title: "Missing Desc" },
            { id: "blank", title: "Blank Desc", desc: "   " },
            { id: "described", title: "Described", desc: "Real description" },
          ],
        },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates.map((candidate) => candidate.item.id)).toEqual(["described"]);
  });

  // ---- 7: item with blank title is excluded ----
  it("excludes items whose title is blank or whitespace-only", () => {
    const candidates = selectHeroCandidates(
      [
        {
          name: "热门电影",
          items: [
            { id: "notitle", title: "   ", desc: "Has desc" },
            { id: "hastitle", title: "Has Title", desc: "Has desc" },
          ],
        },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates).toHaveLength(1);
    expect(candidates[0].item.id).toBe("hastitle");
  });

  // ---- 8: shuffle reorders per random source ----
  it("shuffles with the provided random source and limits to the requested count", () => {
    const candidates = selectHeroCandidates([section("热门电影", ["a", "b", "c", "d"])], 3, alwaysZero);

    expect(candidates.map((candidate) => candidate.item.id)).toEqual(["b", "c", "d"]);
  });

  // ---- 9: limit caps count ----
  it("returns at most `limit` candidates when there are more qualifying items", () => {
    const candidates = selectHeroCandidates([section("热门电影", ["a", "b", "c", "d", "e"])], 3, alwaysHigh);

    expect(candidates).toHaveLength(3);
  });

  // ---- 10: zero limit ----
  it("returns an empty array when limit is 0", () => {
    const candidates = selectHeroCandidates([section("热门电影", ["a", "b"])], 0, alwaysHigh);

    expect(candidates).toHaveLength(0);
  });

  // ---- 11: limit larger than candidate count ----
  it("returns all candidates when limit exceeds the number of qualifying items", () => {
    const candidates = selectHeroCandidates([section("热门电影", ["a", "b"])], 100, alwaysHigh);

    expect(candidates).toHaveLength(2);
  });

  // ---- 12: key uses non-blank id ----
  it("uses the item id as deduplication key when id is non-blank", () => {
    // Two items with the same title but different ids should both be kept.
    // 同 title 但不同 id 的两个条目均应保留.
    const candidates = selectHeroCandidates(
      [
        {
          name: "热门电影",
          items: [
            { id: "id-1", title: "Same Title", desc: "desc one" },
            { id: "id-2", title: "Same Title", desc: "desc two" },
          ],
        },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates).toHaveLength(2);
  });

  // ---- 13: key uses trimmed title when id is blank ----
  it("uses the trimmed title as deduplication key when id is blank", () => {
    // "  Same Title  " trimmed → "Same Title"; second with blank id and same title is a duplicate.
    // trim 后相同 title、id 为空的第二个条目是重复项.
    const candidates = selectHeroCandidates(
      [
        {
          name: "热门电影",
          items: [
            { id: "", title: "  Same Title  ", desc: "first" },
            { id: "", title: "Same Title", desc: "second" },
          ],
        },
      ],
      6,
      alwaysHigh,
    );

    expect(candidates).toHaveLength(1);
  });

  // ---- 14: whitespace-only id treated as blank ----
  it("treats a whitespace-only id as blank and falls back to title for deduplication", () => {
    // An id of "   " trims to "" — deduplication should fall back to title.
    // id "   " trim 后为 "" — 去重应退回 title.
    const candidates = selectHeroCandidates(
      [
        { name: "热门电影", items: [{ id: "   ", title: "Whitespace ID", desc: "first" }] },
        { name: "热门剧集", items: [{ id: "   ", title: "Whitespace ID", desc: "second" }] },
      ],
      6,
      alwaysHigh,
    );

    // Both have the same blank-trimmed id and same title → only the first is kept.
    // 两者的 id trim 后均为空且 title 相同 → 只保留第一个.
    expect(candidates).toHaveLength(1);
  });
});
