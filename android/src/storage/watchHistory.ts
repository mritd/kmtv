// MMKV-backed watch history mirroring apple/Shared/Storage/WatchHistory.swift semantics:
// upsert by title, trim to 100, recent(limit) sort by updatedAt desc, clearAll.
// 基于 MMKV 的观看历史, 与 apple/Shared/Storage/WatchHistory.swift 语义一致:
// 按 title upsert, 保留 100 条上限, recent(limit) 按 updatedAt 倒序, clearAll.

import { getNamespacedStorage, readJSON, writeJSON } from "./mmkv";

const KEY = "kmtv:watchHistory";
const HARD_CAP = 100;
const DEFAULT_LIMIT = 10;

/**
 * Monotonic clock — guarantees a strictly-increasing timestamp even when two `Date.now()`
 * reads land in the same millisecond. iOS gets this from `Date.now` + SwiftData's PK ordering;
 * we approximate by bumping the last value by 1.
 * 单调时钟, 保证即便两次 `Date.now()` 落在同一毫秒, 时间戳也严格递增.
 * iOS 借助 `Date.now` + SwiftData 主键顺序天然有此保证, 我们用最后值 +1 近似.
 */
let lastStamp = 0;
function nextStamp(): number {
  const now = Date.now();
  lastStamp = now > lastStamp ? now : lastStamp + 1;
  return lastStamp;
}

/**
 * Persisted shape — flat JSON, no class behaviour (unlike SwiftData).
 * 持久化形状 — 扁平 JSON, 不持有方法 (与 SwiftData 行为不同).
 */
export interface WatchHistoryItem {
  id: string;
  sourceKey: string;
  videoId: string;
  title: string;
  cover: string;
  episode: string;
  episodeIndex: number;
  progress: number;
  duration: number;
  updatedAt: number;
}

/**
 * Load the most recent `limit` items for the given server, sorted by updatedAt desc.
 * 按 updatedAt 倒序加载该 server 的最近 `limit` 条记录.
 */
export function loadWatchHistory(serverURL: string, limit: number = DEFAULT_LIMIT): WatchHistoryItem[] {
  const storage = getNamespacedStorage(serverURL);
  const all = readJSON<WatchHistoryItem[]>(storage, KEY, []);
  return [...all]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * Upsert by title (matches SwiftData `#Predicate { $0.title == title }`), then trim to HARD_CAP.
 * 按 title upsert (与 SwiftData 中 `#Predicate { $0.title == title }` 一致), 然后裁剪到 HARD_CAP.
 */
export function recordPlayProgress(
  serverURL: string,
  item: Omit<WatchHistoryItem, "updatedAt">,
): void {
  const storage = getNamespacedStorage(serverURL);
  const list = readJSON<WatchHistoryItem[]>(storage, KEY, []);
  const stamped: WatchHistoryItem = { ...item, updatedAt: nextStamp() };
  const i = list.findIndex((e) => e.title === item.title);
  if (i >= 0) {
    list[i] = { ...list[i], ...stamped };
  } else {
    list.push(stamped);
  }
  // Trim by updatedAt desc to HARD_CAP, matching iOS `fetchOffset = 100` (drop older entries).
  // 按 updatedAt 倒序裁剪到 HARD_CAP, 对应 iOS 中 `fetchOffset = 100` (丢弃更旧的条目).
  list.sort((a, b) => b.updatedAt - a.updatedAt);
  if (list.length > HARD_CAP) list.length = HARD_CAP;
  writeJSON(storage, KEY, list);
}

/**
 * Remove the whole watch history for the server.
 * 清空该 server 的全部观看历史.
 */
export function clearWatchHistory(serverURL: string): void {
  const storage = getNamespacedStorage(serverURL);
  storage.remove(KEY);
}
