/**
 * categoryItems — pure helper that flattens infinite-query pages into a deduplicated item list.
 * categoryItems — 将无限查询的分页扁平化为去重条目列表的纯函数.
 *
 * Why dedup / 为何去重:
 *   Douban pagination can return overlapping items across pages (the same id may appear on two
 *   consecutive pages). The iOS client dedups on append; the web client dedups here at render time
 *   so the grid never shows a duplicate poster or triggers duplicate React keys.
 *   豆瓣分页在不同页之间可能返回重叠条目 (同一 id 可能出现在相邻两页). iOS 客户端在追加时去重;
 *   web 客户端在此于渲染期去重, 使网格不会出现重复海报或重复 React key.
 *
 * Key exports / 主要导出:
 *   flattenCategoryPages
 *
 * Callers / 调用方:
 *   viewer/categories/CategoriesPage.tsx
 */

import type { DoubanItem, DoubanListResponse } from "@/api/types";

/**
 * flattenCategoryPages concatenates all infinite-query pages and removes duplicate items by id.
 * flattenCategoryPages
 * 拼接所有无限查询分页并按 id 移除重复条目.
 *
 * The first occurrence of each id wins, preserving upstream ordering. Returns an empty array when
 * `pages` is undefined (query not yet resolved), so callers can render without a null check.
 * 每个 id 以首次出现者为准, 保留上游顺序. 当 pages 为 undefined (查询尚未解析) 时返回空数组,
 * 使调用方无需额外的空值判断即可渲染.
 */
export function flattenCategoryPages(pages: DoubanListResponse[] | undefined): DoubanItem[] {
  if (!pages) return [];
  const seen = new Set<string>();
  const result: DoubanItem[] = [];
  for (const page of pages) {
    for (const item of page.items) {
      if (seen.has(item.id)) continue;
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}
