// MMKV-backed watch history mirroring apple/Shared/Storage/WatchHistory.swift semantics:
// upsert by title, trim to 100, recent(limit) sort by updatedAt desc, clearAll.
// 基于 MMKV 的观看历史, 与 apple/Shared/Storage/WatchHistory.swift 语义一致:
// 按 title upsert, 保留 100 条上限, recent(limit) 按 updatedAt 倒序, clearAll.

import { getNamespacedStorage, readJSON, writeJSON } from "./mmkv";
import type { WatchHistoryRequest, WatchHistoryResponseItem } from "@/api/types";

const LEGACY_KEY = "kmtv:watchHistory";
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
	groupIndex: number;
	episodeIndex: number;
  progress: number;
	duration: number;
	completed: boolean;
	updatedAt: number;
}

function historyKey(userID: number): string {
	return `kmtv:watchHistory:user:${Math.max(0, userID)}`;
}

function removeLegacyHistory(serverURL: string): void {
	getNamespacedStorage(serverURL).remove(LEGACY_KEY);
}

/**
 * Convert a server item into the local MMKV shape.
 * 将服务端条目转换为本地 MMKV 形状.
 */
export function watchHistoryItemFromRemote(item: WatchHistoryResponseItem): WatchHistoryItem {
  return {
    id: `${item.source_key}:${item.video_id}:${item.episode_index}`,
    sourceKey: item.source_key,
    videoId: item.video_id,
    title: item.title,
    cover: item.cover,
		episode: item.episode,
		groupIndex: item.group_index,
		episodeIndex: item.episode_index,
    progress: item.progress_sec,
		duration: item.duration_sec,
		completed: item.completed,
		updatedAt: Date.parse(item.updated_at) || Date.now(),
  };
}

/**
 * Convert a local watch-history item into the server PUT /history payload.
 * 将本地观看历史条目转换为服务端 PUT /history 请求体.
 */
export function watchHistoryRequestFromItem(item: Omit<WatchHistoryItem, "updatedAt">): WatchHistoryRequest {
  return {
    source_key: item.sourceKey,
    video_id: item.videoId,
    title: item.title,
    cover: item.cover,
    episode: item.episode,
		group_index: item.groupIndex,
    episode_index: item.episodeIndex,
    progress_sec: item.progress,
    duration_sec: item.duration,
		completed: item.completed,
		event_time_ms: nextStamp(),
  };
}

/**
 * Load the most recent `limit` items for the given server, sorted by updatedAt desc.
 * 按 updatedAt 倒序加载该 server 的最近 `limit` 条记录.
 */
export function loadWatchHistory(serverURL: string, limit: number = DEFAULT_LIMIT, userID: number = 0): WatchHistoryItem[] {
	const storage = getNamespacedStorage(serverURL);
	removeLegacyHistory(serverURL);
	const all = readJSON<WatchHistoryItem[]>(storage, historyKey(userID), []);
	return [...all]
		.map((item) => ({ ...item, groupIndex: item.groupIndex ?? 0, completed: item.completed ?? false }))
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
	userID: number = 0,
): void {
	const storage = getNamespacedStorage(serverURL);
	removeLegacyHistory(serverURL);
	const key = historyKey(userID);
	const list = readJSON<WatchHistoryItem[]>(storage, key, []);
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
	writeJSON(storage, key, list);
}

/**
 * Remove the whole watch history for the server.
 * 清空该 server 的全部观看历史.
 */
export function clearWatchHistory(serverURL: string, userID: number = 0): void {
	const storage = getNamespacedStorage(serverURL);
	removeLegacyHistory(serverURL);
	storage.remove(historyKey(userID));
}

/**
 * Remove one title from a user's local watch-history cache.
 * 从指定用户的本地观看历史缓存中删除一个标题.
 */
export function deleteWatchHistory(serverURL: string, title: string, userID: number = 0): void {
	const storage = getNamespacedStorage(serverURL);
	removeLegacyHistory(serverURL);
	const key = historyKey(userID);
	const list = readJSON<WatchHistoryItem[]>(storage, key, []);
	writeJSON(storage, key, list.filter((item) => item.title !== title));
}
