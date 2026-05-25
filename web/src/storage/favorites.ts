/**
 * storage/favorites.ts — per-user favorites list backed by localStorage.
 *
 * storage/favorites.ts — 基于 localStorage 的用户收藏列表.
 *
 * localStorage key: "kmtv.favorites"
 * Schema: FavoriteItem[] (JSON array, no version field — schema is locked at Tier 4)
 *
 * Callers: viewer/favorites/FavoritesPage, viewer/search/SearchResults, viewer/detail/DetailPage,
 *          viewer/home/RecommendedSection (read-only).
 *
 * NOTE: This module intentionally does NOT register a user-scoped reset because favorites are
 * device-local preferences, not server-session state. They survive logout by design.
 * 注意: 本模块不注册用户范围重置, 因为收藏是设备本地偏好, 而非服务器会话状态.
 * 它们在登出后仍保留, 这是有意为之.
 */
import type { SearchResult, SourceResult } from "@/api/types";

// LOCKED storage key — must not change. Renaming breaks existing user data.
// 锁定的存储键 — 禁止更改, 重命名会破坏现有用户数据.
export const favoritesKey = "kmtv.favorites";

/**
 * FavoriteItem represents a single favorited title pinned to a specific source entry.
 * One logical media title may produce multiple FavoriteItems if the user favorites it
 * from different source keys.
 *
 * FavoriteItem 表示用户收藏的某个标题, 固定关联到一个特定的 source 条目.
 * 同一媒体可能因用户从不同 source 收藏而产生多个 FavoriteItem.
 */
export interface FavoriteItem {
  title: string;
  type?: string;
  year?: string;
  cover?: string;
  desc?: string;
  rate?: string;
  source: SourceResult;
}

// readItems — parse localStorage, return [] on any error or unexpected schema.
// Guards against non-array JSON (e.g. `{}` or a scalar) to prevent downstream callers
// from crashing on `.some()`/`.filter()` when the stored value is not an array.
// readItems — 解析 localStorage, 任何错误或意外 schema 时返回 [].
// 防止非数组 JSON (如 `{}` 或标量) 导致下游调用方在非数组上调用 `.some()`/`.filter()` 而崩溃.
function readItems(): FavoriteItem[] {
  try {
    const raw = window.localStorage.getItem(favoritesKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      // Stored value is not an array — treat as corrupt and clear it.
      // 存储值不是数组 — 视为损坏并清除.
      window.localStorage.removeItem(favoritesKey);
      return [];
    }
    return parsed as FavoriteItem[];
  } catch {
    // Corrupt favorite data should not block browsing.
    // Remove the bad entry so the next write starts clean.
    // 损坏的收藏数据不能阻塞浏览. 清除损坏条目, 下次写入从头开始.
    window.localStorage.removeItem(favoritesKey);
    return [];
  }
}

// writeItems — serialize and persist the full list.
// writeItems — 序列化并持久化完整列表.
function writeItems(items: FavoriteItem[]): void {
  window.localStorage.setItem(favoritesKey, JSON.stringify(items));
}

/**
 * favoriteID returns the stable identity string for a stored FavoriteItem.
 * Format: "<source_key>:<video_id>" — mirrors sourceFavoriteID for cross-function consistency.
 *
 * favoriteID 返回已存储 FavoriteItem 的稳定标识字符串.
 * 格式: "<source_key>:<video_id>" — 与 sourceFavoriteID 保持一致.
 */
export function favoriteID(item: FavoriteItem): string {
  return `${item.source.source_key}:${item.source.video_id}`;
}

/**
 * sourceFavoriteID returns the identity string for a SourceResult before it is stored.
 * Used for membership checks against the ID set built from stored items.
 *
 * sourceFavoriteID 返回 SourceResult 尚未存储时的标识字符串.
 * 用于与已存储条目的 ID 集合做成员检查.
 */
export function sourceFavoriteID(source: SourceResult): string {
  return `${source.source_key}:${source.video_id}`;
}

/**
 * mediaFavoriteID returns a normalized media-level identity for deduplication across sources.
 * Two items with the same normalized title + year are considered the same media.
 * Normalization: trim + toLocaleLowerCase, so "Demo Show" and "demo show" are the same.
 *
 * mediaFavoriteID 返回规范化的媒体级标识, 用于跨 source 去重.
 * 同一规范化 title + year 的两条记录视为同一媒体.
 * 规范化: trim + toLocaleLowerCase, "Demo Show" 与 "demo show" 等同.
 */
export function mediaFavoriteID(item: Pick<FavoriteItem, "title" | "year">): string {
  return `${item.title.trim().toLocaleLowerCase()}:${item.year?.trim() ?? ""}`;
}

/**
 * resultFavoriteIDs returns the complete Set of IDs that a SearchResult could match.
 * Includes: the media-level ID, plus one source-level ID per SourceResult in the result.
 * Used by isFavoriteResult to check any possible match in a single pass.
 *
 * resultFavoriteIDs 返回 SearchResult 可能匹配到的完整 ID Set.
 * 包含: 媒体级 ID, 以及结果中每个 SourceResult 对应的 source 级 ID.
 * 被 isFavoriteResult 用于单次扫描判断是否存在任意匹配.
 */
export function resultFavoriteIDs(result: SearchResult): Set<string> {
  const ids = new Set<string>([mediaFavoriteID(result)]);
  if (Array.isArray(result.sources)) {
    for (const source of result.sources) {
      ids.add(sourceFavoriteID(source));
    }
  }
  return ids;
}

/**
 * makeFavorite constructs a FavoriteItem from a SearchResult and the chosen SourceResult.
 * The caller picks which source to pin — typically the first available or the currently active one.
 *
 * makeFavorite 从 SearchResult 和所选 SourceResult 构造 FavoriteItem.
 * 调用方选择要固定的 source, 通常是第一个可用的或当前激活的.
 */
export function makeFavorite(result: SearchResult, source: SourceResult): FavoriteItem {
  return {
    title: result.title,
    type: result.type,
    year: result.year,
    cover: result.cover,
    desc: result.desc,
    rate: result.rate,
    source,
  };
}

/**
 * listFavorites returns a snapshot of all stored favorites, newest-first.
 * Returns [] on corrupt storage.
 *
 * listFavorites 返回所有已存储收藏的快照, 最新在前.
 * 存储损坏时返回 [].
 */
export function listFavorites(): FavoriteItem[] {
  return readItems();
}

/**
 * favoriteIDs returns a Set containing both the source-level ID and media-level ID for every
 * stored FavoriteItem. Callers use this Set for O(1) membership tests.
 *
 * favoriteIDs 返回包含每个已存储 FavoriteItem 的 source 级 ID 和媒体级 ID 的 Set.
 * 调用方用此 Set 做 O(1) 成员检查.
 */
export function favoriteIDs(): Set<string> {
  const ids = new Set<string>();
  for (const item of readItems()) {
    ids.add(favoriteID(item));
    ids.add(mediaFavoriteID(item));
  }
  return ids;
}

/**
 * isFavoriteSource returns true if the given SourceResult is already in the favorites list.
 * Used by per-source action buttons to decide their toggled state.
 *
 * isFavoriteSource 如果给定 SourceResult 已在收藏列表中则返回 true.
 * 被每个 source 的操作按钮用于决定其切换状态.
 */
export function isFavoriteSource(source: SourceResult): boolean {
  return favoriteIDs().has(sourceFavoriteID(source));
}

/**
 * isFavoriteResult returns true if any source or the media identity of the given SearchResult
 * matches an existing favorite. Used by search result cards to show a "favorited" badge.
 *
 * isFavoriteResult 如果给定 SearchResult 的任意 source 或媒体标识与现有收藏匹配则返回 true.
 * 被搜索结果卡片用于显示"已收藏"徽章.
 */
export function isFavoriteResult(result: SearchResult): boolean {
  const ids = favoriteIDs();
  return Array.from(resultFavoriteIDs(result)).some((id) => ids.has(id));
}

/**
 * toggleResultFavorite adds or removes a favorite entry for an entire SearchResult.
 * When adding, it always uses the first SourceResult in the result.
 * When removing, it matches by either source-level ID or media-level ID to catch
 * items previously stored under a different source for the same media.
 * Returns the new list (newest-first).
 *
 * toggleResultFavorite 为整个 SearchResult 添加或移除收藏条目.
 * 添加时始终使用结果中第一个 SourceResult.
 * 移除时通过 source 级 ID 或媒体级 ID 匹配, 以捕获同一媒体下以不同 source 存储的条目.
 * 返回新列表 (最新在前).
 */
export function toggleResultFavorite(result: SearchResult): FavoriteItem[] {
  const resultIDs = resultFavoriteIDs(result);
  const items = readItems();
  const exists = items.some((item) => resultIDs.has(favoriteID(item)) || resultIDs.has(mediaFavoriteID(item)));
  if (exists) {
    const next = items.filter((item) => !resultIDs.has(favoriteID(item)) && !resultIDs.has(mediaFavoriteID(item)));
    writeItems(next);
    return next;
  }

  const source = Array.isArray(result.sources) ? result.sources[0] : undefined;
  if (!source) {
    // No usable source — return unchanged list rather than creating an incomplete entry.
    // 没有可用 source — 返回未修改的列表, 不创建不完整条目.
    return items;
  }
  const next = [makeFavorite(result, source), ...items];
  writeItems(next);
  return next;
}

/**
 * toggleFavorite adds or removes a specific FavoriteItem by its exact source-level identity.
 * Used when the caller already knows the precise item (e.g. FavoritesPage remove button).
 * Returns the new list (newest-first).
 *
 * toggleFavorite 通过精确的 source 级标识添加或移除特定 FavoriteItem.
 * 在调用方已知精确条目时使用 (例如 FavoritesPage 的移除按钮).
 * 返回新列表 (最新在前).
 */
export function toggleFavorite(item: FavoriteItem): FavoriteItem[] {
  const id = favoriteID(item);
  const items = readItems();
  const exists = items.some((current) => favoriteID(current) === id);
  const next = exists ? items.filter((current) => favoriteID(current) !== id) : [item, ...items];
  writeItems(next);
  return next;
}
