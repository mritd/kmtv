/**
 * heroCandidates — pure helper that selects and shuffles hero carousel candidates from home sections.
 * heroCandidates — 纯函数模块, 从首页分区中筛选并随机排序英雄轮播候选项.
 *
 * Responsibilities / 职责:
 *   - Filter DoubanItem entries that have both a non-blank title and a non-blank description
 *     — 过滤同时具有非空 title 和非空 description 的 DoubanItem 条目
 *   - Deduplicate by item ID (falling back to title when id is blank)
 *     — 按 item ID 去重 (id 为空时改用 title)
 *   - Shuffle using the provided random source (injectable for tests)
 *     — 使用可注入的 random 函数 shuffle (便于测试确定性)
 *   - Return at most `limit` candidates (default 6)
 *     — 最多返回 `limit` 个候选项 (默认 6)
 *
 * Key exports / 主要导出:
 *   HeroCandidate, selectHeroCandidates
 *
 * Callers / 调用方:
 *   viewer/home/HomePage.tsx (feeds heroCandidates prop to HomeHero)
 *
 * Pure module — no side effects, no imports besides types.
 * 纯模块 — 无副作用, 除类型外无 import.
 */

import type { DoubanHomeSection, DoubanItem } from "@/api/types";

/**
 * HeroCandidate is a single item eligible for the home hero carousel.
 * HeroCandidate
 * 是首页英雄轮播中的一个候选条目.
 *
 * sectionName is forwarded to HomeHero so it can display the originating section label.
 * sectionName 传递给 HomeHero 以显示来源分区标签.
 */
export interface HeroCandidate {
  sectionName: string;
  item: DoubanItem;
}

/**
 * candidateKey returns a stable deduplication key for a DoubanItem.
 * candidateKey
 * 返回 DoubanItem 的稳定去重 key.
 *
 * Prefers the numeric ID when present; falls back to the trimmed title so items
 * that share the same title across sections are only shown once.
 * 优先使用数字 ID; 当 id 为空时退回到 trim 后的 title, 避免同名条目在多分区重复出现.
 */
function candidateKey(item: DoubanItem): string {
  const id = item.id.trim();
  return id ? `id:${id}` : `title:${item.title.trim()}`;
}

/**
 * selectHeroCandidates builds a shuffled, deduplicated list of hero candidates.
 * selectHeroCandidates
 * 构建已 shuffle 且去重后的英雄候选列表.
 *
 * Only items with both a non-blank title and a non-blank description qualify.
 * A description is required so the hero copy block is never empty.
 * 仅同时具有非空 title 和非空 description 的条目才符合条件.
 * 要求 description 是为了确保英雄文案区域不为空.
 *
 * Deduplication uses `candidateKey`: id-based first, then title-based. A later
 * occurrence of the same key is silently dropped regardless of section.
 * 去重使用 candidateKey: 优先 id, 其次 title. 相同 key 的后续出现会被静默丢弃.
 *
 * The Fisher-Yates shuffle uses `random` (injectable) so tests are deterministic.
 * Fisher-Yates shuffle 使用可注入的 random, 使测试结果可确定.
 *
 * @param sections - All home recommendation sections from the Douban API.
 *                   来自豆瓣 API 的所有首页推荐分区.
 * @param limit    - Maximum number of candidates to return (default 6).
 *                   最多返回的候选数量 (默认 6).
 * @param random   - Random source used for shuffling (default Math.random).
 *                   用于 shuffle 的随机源 (默认 Math.random).
 * @returns        Shuffled candidates, at most `limit` items.
 *                 已 shuffle 的候选列表, 最多 `limit` 项.
 */
export function selectHeroCandidates(
  sections: DoubanHomeSection[],
  limit = 6,
  random: () => number = Math.random,
): HeroCandidate[] {
  const seen = new Set<string>();
  const candidates: HeroCandidate[] = [];

  for (const section of sections) {
    for (const item of section.items) {
      const title = item.title.trim();
      const desc = item.desc?.trim() ?? "";
      // Both title and description must be non-blank; the hero copy block requires a description.
      // title 和 description 均须非空; 英雄文案区需要 description 才不为空.
      if (!title || !desc) {
        continue;
      }

      const key = candidateKey(item);
      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      candidates.push({ sectionName: section.name, item });
    }
  }

  // Fisher-Yates in-place shuffle on a copy so the input array is not mutated.
  // 对副本原地执行 Fisher-Yates shuffle, 不修改原始数组.
  const shuffled = [...candidates];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled.slice(0, limit);
}
