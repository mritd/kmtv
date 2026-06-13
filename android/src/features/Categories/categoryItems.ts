// Flatten infinite-query pages into a deduplicated item list (mirror web).
// 将无限查询的分页扁平化为去重条目列表 (与 web 一致).

import type { DoubanItem, DoubanListResponse } from "@/api/types";

/**
 * flattenCategoryPages concatenates all pages and removes duplicate items by id.
 * flattenCategoryPages 拼接所有分页并按 id 去重.
 *
 * Why dedup here: Douban pagination can return overlapping items across adjacent pages; the
 * first occurrence of each id wins so upstream ordering is preserved. Returns [] when pages
 * is undefined so callers render unconditionally.
 * 为何在此去重: 豆瓣分页相邻页之间可能重复出现同一条目; 保留首次出现以维持上游顺序.
 * pages 为 undefined 时返回 [], 调用方无需额外空值判断.
 */
export function flattenCategoryPages(pages: DoubanListResponse[] | undefined): DoubanItem[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const out: DoubanItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      out.push(item);
    }
  }
  return out;
}
